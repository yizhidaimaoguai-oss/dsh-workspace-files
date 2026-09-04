/** Workspace-scoped desktop grants. Only one-use pairing tickets cross the URI handler. */
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { FileError, validatePath, readText, saveText, listFiles, statFile } from './files.js';
const hash = value => createHash('sha256').update(value).digest('hex');
export class DesktopGrants {
  constructor(file, days = 30, clock = Date.now) {
    this.file = file; this.days = days; this.clock = clock; this.tickets = new Map(); this.grants = []; this.queue = Promise.resolve();
  }
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.grants)) throw new Error('Invalid desktop grant store');
      for (const g of saved.grants) if (typeof g.id !== 'string' || !/^[a-f0-9]{64}$/.test(g.hash) || typeof g.workspace !== 'string' || typeof g.root !== 'string' || !Number.isFinite(g.expires)) throw new Error('Invalid desktop grant');
      this.grants = saved.grants;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async persist() {
    const json = JSON.stringify({ version: 1, grants: this.grants });
    const operation = this.queue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temp = this.file + '.' + randomUUID() + '.tmp';
      await writeFile(temp, json, { mode: 0o600, flag: 'wx' }); await rename(temp, this.file);
    });
    this.queue = operation; await operation;
  }
  issue(workspace, path) {
    validatePath(path);
    for (const [key, value] of this.tickets) if (value.expires <= this.clock()) this.tickets.delete(key);
    if (this.tickets.size >= 128) throw new FileError(429, '配对请求过多，请稍后再试');
    const ticket = randomBytes(32).toString('base64url');
    this.tickets.set(hash(ticket), { workspace: workspace.id, root: workspace.path, title: workspace.title, path, expires: this.clock() + 60000 });
    return { ticket, expiresIn: 60, clientTokenDays: this.days };
  }
  async exchange(ticket) {
    if (typeof ticket !== 'string') throw new FileError(401, '配对凭据无效');
    const key = hash(ticket), pending = this.tickets.get(key); this.tickets.delete(key);
    if (!pending || pending.expires <= this.clock()) throw new FileError(401, '配对链接已使用或已过期，请回到 DSH 重新连接');
    const token = randomBytes(32).toString('base64url');
    const grant = { id: randomUUID(), hash: hash(token), workspace: pending.workspace, root: pending.root, title: pending.title, created: this.clock(), expires: this.clock() + this.days * 86400000 };
    this.grants.push(grant);
    try { await this.persist(); } catch (error) { this.grants = this.grants.filter(g => g.id !== grant.id); throw error; }
    return { token, grantId: grant.id, workspace: { id: grant.workspace, title: grant.title, path: grant.root }, openPath: pending.path, expires: grant.expires };
  }
  authorize(header) {
    if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) throw new FileError(401, '请在 DSH 网页中重新授权本机 VSCode');
    const digest = hash(header.slice(7));
    const grant = this.grants.find(g => g.hash === digest && g.expires > this.clock());
    if (!grant) throw new FileError(401, 'VSCode 授权已过期或已撤销，请在 DSH 网页重新连接');
    return grant;
  }
  list() { return this.grants.filter(g => g.expires > this.clock()).map(({ hash: _hash, root: _root, ...g }) => g); }
  async revoke(id) { this.grants = this.grants.filter(g => g.id !== id); await this.persist(); }
}
async function body(req, limit) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new FileError(415, '需要 JSON');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new FileError(413, '请求过大');
    chunks.push(chunk);
  }
  try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error(); return parsed; }
  catch { throw new FileError(400, 'JSON 无效'); }
}
export function desktopHandler(ctx, config, grants) {
  return async (req, res) => {
    let status = 200, data;
    try {
      // Keep the DSH Host/Origin fence. Desktop authentication below replaces only its cookie check.
      if (ctx.connection.requestRejection(req) === 403) throw new FileError(403, '请求来源无效');
      const url = new URL(req.url, 'http://dsh.internal');
      const route = url.pathname.slice('/dsh-files-bridge/'.length);
      if (route === 'exchange' && req.method === 'POST') data = await grants.exchange((await body(req, 4096)).ticket);
      else {
        const grant = grants.authorize(req.headers.authorization);
        const workspace = ctx.workspaceRegistry.get(grant.workspace);
        if (!workspace || workspace.path !== grant.root) throw new FileError(403, '工作目录授权已失效');
        const path = url.searchParams.get('path') || '';
        if (req.method === 'GET' && route === 'info') data = { workspace: { id: workspace.id, title: workspace.title, path: workspace.path }, grantId: grant.id, expires: grant.expires };
        else if (req.method === 'GET' && route === 'stat') data = await statFile(workspace.path, path);
        else if (req.method === 'GET' && route === 'list') data = await listFiles(workspace.path, path, config.maxEntries);
        else if (req.method === 'GET' && route === 'file') data = await readText(workspace.path, path, config.maxFileBytes);
        else if (req.method === 'PUT' && route === 'file') {
          const input = await body(req, config.maxFileBytes * 6 + 4096);
          data = await saveText(workspace.path, input.path, input.content, input.version, config.maxFileBytes);
        } else throw new FileError(404, '接口不存在');
      }
    } catch (error) {
      status = error.status || ({ ENOENT: 404, ENOTDIR: 404, EACCES: 403, EPERM: 403, ELOOP: 403 }[error.code]) || 500;
      data = { error: status === 500 ? '文件服务失败，请查看 DSH 日志' : error instanceof FileError ? error.message : '文件不存在或无法访问' };
      if (status === 500) console.warn('[dsh-desktop]', error);
    }
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(JSON.stringify(data));
  };
}
