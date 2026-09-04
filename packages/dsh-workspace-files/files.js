/** Workspace file access. Linux pins directory descriptors; other hosts recheck path identities. */
import { constants } from 'node:fs';
import { open, realpath, lstat, opendir, rename, unlink } from 'node:fs/promises';
import { posix, win32, relative, isAbsolute, dirname, basename, join, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class FileError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireString(value, label) {
  if (typeof value !== 'string' || value.includes('\0')) throw new FileError(400, label + '无效');
  return value;
}
function within(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
}
export function validatePath(value, platform = process.platform) {
  requireString(value, '路径');
  if (value.startsWith('/') || /^[a-z]:/i.test(value) || value.includes('\\') || /[\x00-\x1f]/.test(value) || value.split('/').some(p => p === '..')) {
    throw new FileError(403, '路径必须位于当前工作目录内');
  }
  if (platform === 'win32' && value.split('/').some(p => p && p !== '.' &&
      (/[<>:"|?*]/.test(p) || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p)))) {
    throw new FileError(403, '不支持 Windows 设备名、备用数据流或含糊路径');
  }
  return value;
}
async function checkedPath(rootPath, path) {
  validatePath(path);
  const root = await realpath(rootPath);
  let target = root;
  for (const part of path.split('/').filter(p => p && p !== '.')) {
    target = join(target, part);
    if ((await lstat(target)).isSymbolicLink()) throw new FileError(403, '暂不支持符号链接，请打开真实文件所在的工作目录');
  }
  const actual = await realpath(target);
  if (!within(root, actual)) throw new FileError(403, '文件不在当前工作目录内');
  return { root, target: actual, path, identity: await lstat(actual) };
}
function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino && a.isDirectory() === b.isDirectory() && a.isFile() === b.isFile(); }
async function recheck(checked, handle) {
  const current = await checkedPath(checked.root, checked.path);
  if (current.target !== checked.target || !sameFile(current.identity, checked.identity) ||
      (handle && !sameFile(await handle.stat(), checked.identity))) throw new FileError(409, '文件位置已变化，请重新打开');
  if (handle && process.platform === 'linux') {
    const actual = await realpath('/proc/self/fd/' + handle.fd);
    if (!within(checked.root, actual)) throw new FileError(403, '文件位置已变化，请重新打开');
  }
}
async function withFile(root, path, callback) {
  const checked = await checkedPath(root, path);
  if (!checked.identity.isFile()) throw new FileError(415, '只能读取普通文件');
  const file = await open(checked.target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    await recheck(checked, file);
    const stat = await file.stat();
    if (!stat.isFile()) throw new FileError(415, '只能读取普通文件');
    const result = await callback(file, stat, checked);
    await recheck(checked, file);
    return result;
  } finally { await file.close(); }
}
async function directoryAnchor(root, path) {
  const checked = await checkedPath(root, path);
  if (!checked.identity.isDirectory()) throw new FileError(404, '目录不存在');
  const handle = process.platform === 'linux'
    ? await open(checked.target, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW) : null;
  try { await recheck(checked, handle); } catch (error) { await handle?.close(); throw error; }
  return {
    path: handle ? '/proc/self/fd/' + handle.fd : checked.target,
    verify: () => recheck(checked, handle),
    close: () => handle?.close(),
    sync: async () => { if (handle) await handle.sync(); },
  };
}
async function limitedRead(file, maxBytes) {
  const bytes = Buffer.alloc(maxBytes + 1);
  let used = 0;
  while (used < bytes.length) {
    const result = await file.read(bytes, used, bytes.length - used, used);
    if (result.bytesRead === 0) break;
    used += result.bytesRead;
  }
  if (used > maxBytes) throw new FileError(413, '文件超过大小限制，请在 VSCode 中打开');
  return bytes.subarray(0, used);
}
function revision(stat) { return [stat.dev, stat.ino, stat.mtimeMs, stat.ctimeMs, stat.size].join(':'); }
function version(bytes, stat) {
  return createHash('sha256').update(bytes).update('|' + stat.dev + ':' + stat.ino + ':' + stat.mode + ':' + stat.mtimeMs + ':' + stat.ctimeMs).digest('hex');
}
function decode(bytes) {
  if (bytes.includes(0)) throw new FileError(415, '二进制文件不能在文本编辑器中编辑');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new FileError(415, '此文件不是 UTF-8 文本，请在 VSCode 中选择正确的编码'); }
}
export async function readText(root, path, limit) {
  return withFile(root, path, async (file, stat) => {
    if (stat.size > limit) throw new FileError(413, '文件超过编辑大小限制，请在 VSCode 中打开');
    const bytes = await limitedRead(file, limit);
    if (revision(await file.stat()) !== revision(stat)) throw new FileError(409, '读取期间文件发生变化，请重新读取');
    return { path, content: decode(bytes), version: version(bytes, stat), revision: revision(stat), bytes: bytes.length, modified: stat.mtime.toISOString() };
  });
}
export async function readBytes(root, path, limit) {
  return withFile(root, path, async (file, stat) => {
    if (stat.size > limit) throw new FileError(413, '文件超过下载大小限制');
    return limitedRead(file, limit);
  });
}
export async function listFiles(rootPath, path, maxEntries) {
  const anchor = await directoryAnchor(rootPath, path);
  try {
    const directory = await opendir(anchor.path);
    const entries = [];
    let truncated = false;
    for await (const entry of directory) {
      if (entries.length >= maxEntries) { truncated = true; break; }
      if (entry.name.startsWith('.dsh-files-save-')) continue;
      entries.push({ name: entry.name, type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other', hidden: entry.name.startsWith('.') });
    }
    entries.sort((a, b) => (a.type === 'directory' ? 0 : 1) - (b.type === 'directory' ? 0 : 1) || a.name.localeCompare(b.name));
    await anchor.verify();
    return { path, entries, truncated };
  } finally { await anchor.close(); }
}
const saves = new Map();
/** Serializes this plugin's saves; external changes are checked immediately before rename. */
export async function saveText(rootPath, path, content, expectedVersion, limit) {
  validatePath(path); requireString(content, '内容'); requireString(expectedVersion, '文件版本');
  if (!expectedVersion) throw new FileError(400, '保存必须提供读取时的文件版本');
  const bytes = Buffer.from(content, 'utf8');
  decode(bytes);
  if (bytes.length > limit) throw new FileError(413, '内容超过编辑大小限制');
  const checked = await checkedPath(rootPath, path);
  // Conservative normalization also serializes case aliases on default macOS volumes.
  const key = checked.target.normalize('NFC').toLowerCase();
  const previous = saves.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const parent = await directoryAnchor(checked.root, relative(checked.root, dirname(checked.target)).split(sep).join('/'));
    let temporary, writtenStat;
    try {
      await parent.verify();
      const parentPath = parent.path;
      const target = join(parentPath, basename(checked.target));
      const current = await readText(checked.root, path, limit);
      if (current.version !== expectedVersion) throw new FileError(409, '文件已被 DSH、VSCode 或其他程序修改。你的编辑已保留，请重新读取后合并。');
      const stat = await lstat(target);
      if (!stat.isFile() || stat.nlink !== 1) throw new FileError(409, '暂不支持保存符号链接或硬链接文件');
      temporary = parentPath + '/.dsh-files-save-' + randomUUID();
      const output = await open(temporary, 'wx', stat.mode & 0o777);
      try { await output.writeFile(bytes); if (process.platform !== 'win32') await output.chmod(stat.mode & 0o777); await output.sync(); writtenStat = await output.stat(); }
      finally { await output.close(); }
      await parent.verify();
      const latest = await readText(checked.root, path, limit);
      if (latest.version !== expectedVersion) throw new FileError(409, '保存期间文件发生变化。你的编辑已保留，请重新读取后合并。');
      const destinationStat = await lstat(target);
      if (destinationStat.ino !== stat.ino || destinationStat.dev !== stat.dev || !destinationStat.isFile()) throw new FileError(409, '文件位置已变化，请重新读取');
      await parent.verify();
      await rename(temporary, target);
      temporary = undefined;
      // The rename has committed. Unsupported directory fsync must not report a failed save.
      await parent.sync().catch(error => console.warn('Directory sync unavailable:', error.code));
      // The PUT response must describe the bytes this writer committed, not a later writer.
      try {
        const saved = await readText(checked.root, path, limit);
        if (saved.content === content) return saved;
      } catch { /* Rename succeeded; keep a conservative snapshot if verification is unavailable. */ }
      return { path, content, bytes: bytes.length, version: version(bytes, writtenStat), revision: revision(writtenStat), modified: writtenStat.mtime.toISOString() };
    } finally {
      if (temporary) await parent.verify().then(() => unlink(temporary)).catch(error => { if (error.code !== 'ENOENT') console.warn('Temporary file cleanup failed:', error.code || error.status); });
      await parent.close();
    }
  });
  saves.set(key, operation);
  try { return await operation; }
  finally { if (saves.get(key) === operation) saves.delete(key); }
}

/** VSCode application link and CLI command for a trusted configured SSH target. */
export function vscodeLinks(sshTarget, root, path = '') {
  validatePath(path);
  const remotePath = /^[a-z]:[\\/]/i.test(root) ? '/' + win32.resolve(root, path).replaceAll('\\', '/') : posix.resolve(root, path);
  const authority = 'ssh-remote+' + sshTarget;
  const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/');
  const argument = 'vscode-remote://' + authority + encodedPath;
  return { uri: 'vscode://vscode-remote/' + authority + encodedPath, command: 'code --' + (path ? 'file' : 'folder') + '-uri "' + argument + '"' };
}

/** Metadata for the desktop virtual file system. Directory handles remain anchored to the workspace. */
export async function statFile(rootPath, path) {
  const metadata = stat => {
    if (!stat.isFile() && !stat.isDirectory()) throw new FileError(415, '只支持普通文件和目录');
    return { type: stat.isDirectory() ? 2 : 1, ctime: stat.birthtimeMs || stat.ctimeMs, mtime: stat.mtimeMs, size: stat.size, revision: revision(stat) };
  };
  const checked = await checkedPath(rootPath, path);
  if (checked.identity.isDirectory()) {
    await recheck(checked);
    return metadata(checked.identity);
  }
  return withFile(rootPath, path, async (_file, stat) => metadata(stat));
}
