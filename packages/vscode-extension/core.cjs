'use strict';
const crypto = require('node:crypto');
function serverUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !['http:', 'https:'].includes(url.protocol)) throw new Error('请输入 DSH 根地址，例如 http://127.0.0.1:3080');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('非本机地址必须使用 HTTPS；SSH 转发可使用 http://127.0.0.1:3080');
  return url.origin;
}
class Bridge {
  constructor(server, token, transport = fetch) { this.server = serverUrl(server); this.token = token; this.transport = transport; }
  async call(route, query = {}, method = 'GET', body) {
    const url = new URL('/dsh-files-bridge/' + route, this.server);
    url.search = new URLSearchParams(query).toString();
    const response = await this.transport(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error || 'DSH 请求失败'); error.status = response.status; throw error; }
    return data;
  }
}
function connectionId(server, workspace) { return crypto.createHash('sha256').update(server + '\n' + workspace).digest('hex').slice(0, 32); }
class Provider {
  constructor(vscode, getBridge, isDirty = () => false) {
    this.vscode = vscode; this.getBridge = getBridge; this.isDirty = isDirty;
    this.versions = new Map(); this.observed = new Map(); this.polling = false; this.disposed = false;
    this.emitter = new vscode.EventEmitter(); this.onDidChangeFile = this.emitter.event;
    this.timer = setInterval(() => { this.poll().catch(() => {}); }, 4000);
    this.timer.unref?.();
  }
  filePath(uri) {
    const value = uri.path.replace(/^\/+/, '');
    if (value.split('/').some(p => p === '..' || p === '.') || value.includes('\\') || value.includes('\0'))
      throw this.vscode.FileSystemError.NoPermissions('路径无效');
    return value;
  }
  async call(uri, route, method = 'GET', body) {
    try { return await (await this.getBridge(uri.authority)).call(route, { path: this.filePath(uri) }, method, body); }
    catch (error) {
      const F = this.vscode.FileSystemError;
      if (error.status === 404) throw F.FileNotFound(uri);
      if ([401, 403].includes(error.status)) throw F.NoPermissions(error.message);
      if (error.status === 409) throw new F(error.message + '；请比较磁盘上的最新内容后重新编辑，当前保存未覆盖远程修改。');
      throw F.Unavailable(error.message);
    }
  }
  async observe(uri) {
    const data = await this.call(uri, 'stat');
    const key = uri.toString();
    // Keep the most recently used files; never scan the entire remote workspace.
    const previous = this.observed.get(key);
    if (previous) this.observed.delete(key);
    this.observed.set(key, { uri, revision: data.revision });
    if (this.observed.size > 256) this.observed.delete(this.observed.keys().next().value);
    if (previous && previous.revision !== data.revision && !this.disposed) {
      this.emitter.fire([{ type: previous.revision === null ? this.vscode.FileChangeType.Created : this.vscode.FileChangeType.Changed, uri }]);
    }
    return data;
  }
  async stat(uri) { return this.observe(uri); }
  async readDirectory(uri) {
    const before = await this.call(uri, 'stat');
    const data = await this.call(uri, 'list');
    if (data.truncated) throw this.vscode.FileSystemError.Unavailable('目录超过服务端条目限制，请缩小目录或调整 maxEntries');
    const key = uri.toString();
    this.observed.delete(key);
    this.observed.set(key, { uri, revision: before.revision });
    if (this.observed.size > 256) this.observed.delete(this.observed.keys().next().value);
    return data.entries.map(e => [e.name, e.type === 'directory' ? 2 : e.type === 'file' ? 1 : 0]);
  }
  async readFile(uri) {
    // Older servers lack a read revision: use the pre-read stat, never a newer post-read stat.
    const before = await this.call(uri, 'stat');
    const data = await this.call(uri, 'file');
    const key = uri.toString();
    if (!this.isDirty(uri) || !this.versions.has(key)) this.versions.set(key, data.version);
    this.observed.delete(key);
    this.observed.set(key, { uri, revision: data.revision ?? before.revision });
    if (this.observed.size > 256) this.observed.delete(this.observed.keys().next().value);
    return Buffer.from(data.content, 'utf8');
  }
  async writeFile(uri, content, options) {
    const key = uri.toString(), version = this.versions.get(key);
    if (!version) throw this.vscode.FileSystemError.NoPermissions('第一版仅支持保存已读取的现有文本文件；请先打开文件。');
    if (options && !options.overwrite) throw this.vscode.FileSystemError.FileExists(uri);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content); }
    catch { throw this.vscode.FileSystemError.NoPermissions('仅支持 UTF-8 文本'); }
    const data = await this.call(uri, 'file', 'PUT', { path: this.filePath(uri), content: text, version });
    this.versions.set(key, data.version);
    // Keep the PUT snapshot as baseline. A post-save stat could swallow another writer's update.
    const previous = this.observed.get(key);
    this.observed.set(key, { uri, revision: data.revision ?? previous?.revision ?? null });
    if (this.observed.size > 256) this.observed.delete(this.observed.keys().next().value);
    this.emitter.fire([{ type: this.vscode.FileChangeType.Changed, uri }]);
  }
  watch(uri) { this.observe(uri).catch(() => {}); return { dispose() {} }; }
  async poll() {
    if (this.polling || this.disposed) return;
    this.polling = true;
    try {
      const changes = [];
      for (const [key, old] of [...this.observed]) {
        if (this.disposed) break;
        try {
          const data = await this.call(old.uri, 'stat');
          if (data.revision !== old.revision) {
            if (this.observed.get(key) !== old) continue;
            this.observed.set(key, { uri: old.uri, revision: data.revision });
            changes.push({ type: old.revision === null ? this.vscode.FileChangeType.Created : this.vscode.FileChangeType.Changed, uri: old.uri });
          }
        } catch (error) {
          if (error.code === 'FileNotFound' && old.revision !== null && this.observed.get(key) === old) {
            old.revision = null;
            changes.push({ type: this.vscode.FileChangeType.Deleted, uri: old.uri });
          }
        }
      }
      if (changes.length && !this.disposed) this.emitter.fire(changes);
    } finally { this.polling = false; }
  }
  createDirectory() { throw this.vscode.FileSystemError.NoPermissions('此版本不支持新建目录'); }
  delete() { throw this.vscode.FileSystemError.NoPermissions('此版本不支持删除文件'); }
  rename() { throw this.vscode.FileSystemError.NoPermissions('此版本不支持重命名'); }
  dispose() { this.disposed = true; clearInterval(this.timer); this.emitter.dispose(); this.observed.clear(); this.versions.clear(); }
}
module.exports = { serverUrl, connectionId, Bridge, Provider };
