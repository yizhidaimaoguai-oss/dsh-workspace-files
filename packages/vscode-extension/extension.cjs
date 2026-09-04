'use strict';
const vscode = require('vscode');
const { Bridge, Provider, connectionId, serverUrl } = require('./core.cjs');
const key = 'connections';
function activate(context) {
  const connections = () => context.globalState.get(key, {});
  const secretKey = id => 'dsh-http-files:' + id;
  async function getBridge(id) {
    const meta = connections()[id];
    const token = await context.secrets.get(secretKey(id));
    if (!meta || !token) throw new Error('请先从 DSH 文件网页连接本机 VSCode');
    return new Bridge(meta.server, token);
  }
  const provider = new Provider(vscode, getBridge,
    uri => vscode.workspace.textDocuments.some(d => d.uri.toString() === uri.toString() && d.isDirty));
  context.subscriptions.push(provider, vscode.workspace.registerFileSystemProvider('dshfs', provider, { isCaseSensitive: true }),
    vscode.window.onDidChangeWindowState(s => { if (s.focused) provider.poll(); }));
  async function connect(server, ticket, options = {}) {
    server = serverUrl(server);
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error('配对链接无效，请在 DSH 网页重新生成');
    const reply = await new Bridge(server).call('exchange', {}, 'POST', { ticket });
    const id = connectionId(server, reply.workspace.id);
    await context.secrets.store(secretKey(id), reply.token);
    const all = connections();
    all[id] = { server, workspace: reply.workspace, expires: reply.expires, grantId: reply.grantId };
    await context.globalState.update(key, all);
    const root = vscode.Uri.from({ scheme: 'dshfs', authority: id, path: '/' });
    if (options.open !== false) {
      if (reply.openPath) {
        const uri = root.with({ path: '/' + reply.openPath });
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
      } else await vscode.commands.executeCommand('vscode.openFolder', root, { forceNewWindow: true });
    }
    return { root, id, grantId: reply.grantId };
  }
  async function openLinkedFile(server, workspace, file, line = 1, column = 1) {
    server = serverUrl(server);
    if (typeof workspace !== 'string' || !workspace || typeof file !== 'string' ||
        file.startsWith('/') || /[\0-\x1f\\]/.test(file) || file.split('/').some(p => p === '..' || p === '.'))
      throw new Error('文件链接无效');
    line = Number(line); column = Number(column);
    if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) throw new Error('文件行号无效');
    const id = connectionId(server, workspace);
    const authUrl = server + '/editor/?' + new URLSearchParams({ workspace, path: file });
    let bridge;
    try { bridge = await getBridge(id); await bridge.call('info'); }
    catch (error) {
      if (!connections()[id] || error.status === 401 || error.status === 403 || /请先/.test(error.message)) {
        const refusal = new Error('此工作目录尚未授权或授权已失效，请先在 DSH 网页连接本机 VSCode。');
        refusal.authUrl = authUrl; throw refusal;
      }
      throw error;
    }
    const uri = vscode.Uri.from({ scheme: 'dshfs', authority: id, path: '/' + file });
    const info = await vscode.workspace.fs.stat(uri);
    if (info.type === vscode.FileType.Directory) {
      await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
    } else {
      const doc = await vscode.workspace.openTextDocument(uri);
      const position = doc.validatePosition(new vscode.Position(line - 1, column - 1));
      await vscode.window.showTextDocument(doc, { preview: false, selection: new vscode.Range(position, position) });
    }
    return uri;
  }
  async function handleUri(uri) {
    try {
      const query = new URLSearchParams(uri.query);
      if (uri.path === '/connect') await connect(query.get('server'), query.get('ticket'));
      else if (uri.path === '/open') await openLinkedFile(query.get('server'), query.get('workspace'), query.get('path'), query.get('line') || 1, query.get('column') || 1);
      else throw new Error('未知 DSH 链接');
    } catch (error) {
      const action = await vscode.window.showErrorMessage('DSH: ' + error.message, ...(error.authUrl ? ['前往 DSH 授权'] : []));
      if (action === '前往 DSH 授权') await vscode.env.openExternal(vscode.Uri.parse(error.authUrl));
    }
  }
  context.subscriptions.push(
    vscode.window.registerUriHandler({ handleUri }),
    vscode.commands.registerCommand('dshHttpFiles.connect', async () => {
      await vscode.window.showInformationMessage('在已登录的 DSH 页面打开“文件 / VSCode”，选择工作目录，然后点击“连接本机 VSCode”。');
    }),
    vscode.commands.registerCommand('dshHttpFiles.open', async () => {
      const items = Object.entries(connections()).map(([id, c]) => ({ label: c.workspace.title || c.workspace.path, description: c.server, detail: c.workspace.path, id }));
      const selected = await vscode.window.showQuickPick(items, { placeHolder: '打开已授权的 DSH 工作目录' });
      if (selected) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.from({ scheme: 'dshfs', authority: selected.id, path: '/' }), { forceNewWindow: true });
    }),
    vscode.commands.registerCommand('dshHttpFiles.forget', async () => {
      const all = connections();
      const selected = await vscode.window.showQuickPick(Object.entries(all).map(([id, c]) => ({ label: c.workspace.title || c.workspace.path, description: c.server, id })), { placeHolder: '移除本机保存的连接；服务端授权可在 DSH 网页撤销' });
      if (selected) { await context.secrets.delete(secretKey(selected.id)); delete all[selected.id]; await context.globalState.update(key, all); }
    })
  );
  return { connect, openLinkedFile, provider, getBridge };
}
module.exports = { activate };
