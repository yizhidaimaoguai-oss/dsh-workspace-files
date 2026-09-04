/** DSH host plugin. All routes are carried by the authenticated Connection API. */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { DesktopGrants, desktopHandler } from './desktop.js';
import { extname, basename, join } from 'node:path';
import { FileError, requireString, listFiles, readText, readBytes, saveText, vscodeLinks } from './files.js';
export const name = 'dsh-workspace-files';
export const inject = ['connection', 'workspaceRegistry', 'webServer'];
const base = '/api/workspace-files/';
const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' };
const security = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
function json(data, status = 200) { return Response.json(data, { status, headers: security }); }
export async function apply(ctx, options = {}) {
  if (!['linux', 'win32', 'darwin'].includes(process.platform)) throw new Error('Unsupported DSH host platform');
  const config = { sshTarget: '', maxFileBytes: 2097152, maxDownloadBytes: 52428800, maxEntries: 2000, clientTokenDays: 30, clientStateFile: join(homedir(), '.dsh', 'workspace-files', 'clients.json'), ...options };
  if (typeof config.sshTarget !== 'string' || (config.sshTarget && !/^[A-Za-z0-9_.-]+(?:@[A-Za-z0-9_.-]+)?$/.test(config.sshTarget))) throw new Error('Invalid sshTarget');
  for (const key of ['maxFileBytes', 'maxDownloadBytes', 'maxEntries']) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error('Invalid ' + key);
  }
  if (!Number.isInteger(config.clientTokenDays) || config.clientTokenDays < 1 || config.clientTokenDays > 365) throw new Error('Invalid clientTokenDays');
  const grants = new DesktopGrants(config.clientStateFile, config.clientTokenDays);
  await grants.load();
  const workspace = id => {
    requireString(id, '工作目录');
    const entry = ctx.workspaceRegistry.get(id);
    if (!entry) throw new FileError(404, '工作目录不存在，请在 DSH 中添加工作目录');
    return entry;
  };
  const register = (path, methods, run) => {
    ctx.connection.fetch.register({ path: base + path, methods, fetch: async request => {
      try {
        if ((request.method === 'PUT' || request.method === 'POST')) {
          const origin = request.headers.get('origin');
          if (!origin || new URL(origin).host !== (request.headers.get('host') || new URL(request.url).host) || request.headers.get('x-dsh-workspace-files') !== '1') return json({ error: '保存请求来源无效' }, 403);
          if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: '需要 JSON 请求' }, 415);
        }
        return await run(request, new URL(request.url));
      } catch (error) {
        const status = error.status || ({ ENOENT: 404, ENOTDIR: 404, EACCES: 403, EPERM: 403, ELOOP: 403 }[error.code]) || 500;
        if (status === 500) console.warn('[dsh-workspace-files]', error);
        return json({ error: status === 500 ? '文件操作失败，请检查服务器日志' : error instanceof FileError ? error.message : '文件不存在或无法访问' }, status);
      }
    } });
  };
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-files-bridge', handler: desktopHandler(ctx, config, grants) }), 'workspace-files: desktop API');
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/editor', handler: (req, res) => { res.writeHead(302, { Location: '/api/workspace-files/ui' + new URL(req.url, 'http://dsh.internal').search, 'Cache-Control': 'no-store' }); res.end(); } }), 'workspace-files: editor alias');
  register('desktop-ticket', ['POST'], async request => {
    const input = await request.json();
    const w = workspace(input.workspace);
    return json(grants.issue(w, input.path || ''));
  });
  register('desktop-clients', ['GET', 'POST'], async request => {
    if (request.method === 'POST') { const input = await request.json(); await grants.revoke(requireString(input.id, '客户端')); }
    return json({ clients: grants.list() });
  });
  for (const [route, file, type] of [['ui', 'index.html', 'text/html; charset=utf-8'], ['app.js', 'app.js', 'text/javascript; charset=utf-8'], ['style.css', 'style.css', 'text/css; charset=utf-8']]) {
    register(route, ['GET'], async () => new Response(await readFile(new URL('./public/' + file, import.meta.url)), { headers: {
      ...security, 'Content-Type': type,
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
    } }));
  }
  register('workspaces', ['GET'], async () => json({
    workspaces: ctx.workspaceRegistry.list().map(w => ({ id: w.id, title: w.title, path: w.path, sessionIds: w.sessionIds })),
    sshTarget: config.sshTarget, maxFileBytes: config.maxFileBytes
  }));
  register('list', ['GET'], async (_request, url) => {
    const w = workspace(url.searchParams.get('workspace'));
    return json(await listFiles(w.path, url.searchParams.get('path') || '', config.maxEntries));
  });
  register('file', ['GET', 'PUT'], async (request, url) => {
    if (request.method === 'GET') {
      const w = workspace(url.searchParams.get('workspace'));
      return json(await readText(w.path, url.searchParams.get('path'), config.maxFileBytes));
    }
    const reader = request.body?.getReader();
    if (!reader) throw new FileError(400, '请求为空');
    let length = 0; const chunks = [];
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > config.maxFileBytes * 6 + 4096) { await reader.cancel(); throw new FileError(413, '请求过大'); }
      chunks.push(part.value);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new FileError(400, 'JSON 无效'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new FileError(400, '保存参数无效');
    const w = workspace(body.workspace);
    return json(await saveText(w.path, body.path, body.content, body.version, config.maxFileBytes));
  });
  register('download', ['GET'], async (_request, url) => {
    const w = workspace(url.searchParams.get('workspace'));
    const path = requireString(url.searchParams.get('path'), '路径');
    const preview = url.searchParams.get('preview') === '1';
    const type = preview ? mime[extname(path).toLowerCase()] : undefined;
    const data = await readBytes(w.path, path, config.maxDownloadBytes);
    return new Response(data, { headers: { ...security,
      'Content-Type': type || 'application/octet-stream',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Content-Disposition': (type ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(basename(path)).replace(/'/g, '%27')
    } });
  });
  register('vscode', ['GET'], async (_request, url) => {
    const w = workspace(url.searchParams.get('workspace'));
    if (!config.sshTarget) throw new FileError(400, '尚未配置 SSH 主机');
    return json(vscodeLinks(config.sshTarget, w.path, url.searchParams.get('path') || ''));
  });
}
