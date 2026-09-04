const $ = id => document.getElementById(id);
const base = '/api/workspace-files/';
const state = { workspaces: [], workspace: '', directory: '', entries: [], file: null, original: '', version: '', editable: false, busy: false, generation: 0, eol: '\n', bom: '', command: '' };
const editor = $('editor');
function message(text, type = '') { $('status').textContent = text; $('status').className = type; }
function params(path = '') { return new URLSearchParams({ workspace: state.workspace, path }); }
async function api(route, query, init) {
  const response = await fetch(base + route + (query ? '?' + query : ''), { cache: 'no-store', credentials: 'same-origin', ...init });
  if (response.status === 401) throw new Error('登录已失效，请回到 DSH 页面登录后刷新');
  const body = await response.json();
  if (!response.ok) { const error = new Error(body.error || '请求失败'); error.status = response.status; throw error; }
  return body;
}
function dirty() { return state.editable && editor.value !== state.original; }
function updateControls() {
  $('dirty').textContent = dirty() ? '● 未保存' : '';
  $('save').disabled = !dirty() || state.busy;
  $('reload').disabled = !state.file || state.busy;
  $('workspace').disabled = state.busy;
  editor.readOnly = state.busy;
  document.title = (dirty() ? '● ' : '') + (state.file || '工作目录文件') + ' · DSH';
}
function lineNumbers() {
  const count = editor.value.split('\n').length;
  $('line-numbers').textContent = Array.from({ length: Math.min(count, 50000) }, (_, i) => i + 1).join('\n');
  $('line-numbers').scrollTop = editor.scrollTop;
  updateControls();
}
async function mayDiscard() {
  if (state.busy) return false;
  if (!dirty()) return true;
  const dialog = $('discard-dialog'); dialog.showModal();
  return new Promise(resolve => {
    const done = answer => { dialog.close(); dialog.oncancel = null; resolve(answer); };
    $('discard-cancel').onclick = () => done(false);
    $('discard-confirm').onclick = () => done(true);
    dialog.oncancel = event => { event.preventDefault(); done(false); };
  });
}
function setLink(id, url) {
  $(id).classList.toggle('disabled', !url);
  if (url) $(id).href = url; else $(id).removeAttribute('href');
}
function resetFile() {
  state.file = null; state.editable = false; state.version = ''; state.original = ''; editor.value = '';
  $('filename').textContent = '选择一个文件'; $('editor-wrap').hidden = true; $('preview').hidden = true;
  $('preview').replaceChildren(); $('empty').hidden = false;
  setLink('download', null); setLink('vscode-file', null); updateControls();
}
function renderTree() {
  const fragment = document.createDocumentFragment();
  const search = $('filter').value.toLocaleLowerCase();
  for (const entry of state.entries) {
    if ((!$('hidden').checked && entry.hidden) || !entry.name.toLocaleLowerCase().includes(search)) continue;
    const path = state.directory ? state.directory + '/' + entry.name : entry.name;
    const button = document.createElement('button');
    button.className = state.file === path ? 'selected' : '';
    const icon = document.createElement('span'); icon.textContent = entry.type === 'directory' ? '▸' : entry.type === 'file' ? '≡' : '↗';
    const label = document.createElement('span'); label.textContent = entry.name;
    button.append(icon, label); button.title = path;
    button.onclick = () => entry.type === 'directory' ? navigate(path) : openFile(path);
    button.disabled = entry.type === 'other' || state.busy;
    fragment.append(button);
  }
  $('tree').replaceChildren(fragment);
}
function breadcrumbs() {
  const fragment = document.createDocumentFragment();
  const parts = ['', ...state.directory.split('/').filter(Boolean)];
  parts.forEach((part, index) => {
    const button = document.createElement('button'); button.textContent = index ? '/ ' + part : '工作目录';
    button.onclick = () => navigate(parts.slice(1, index + 1).join('/')); fragment.append(button);
  });
  $('breadcrumbs').replaceChildren(fragment);
}
async function navigate(path) {
  if (state.busy) return;
  const workspace = state.workspace;
  const generation = ++state.generation;
  try {
    const data = await api('list', params(path));
    if (generation !== state.generation || workspace !== state.workspace) return;
    state.directory = path; state.entries = data.entries;
    breadcrumbs(); renderTree();
    $('tree-status').textContent = data.truncated ? '目录较大，仅展示部分条目。请缩小目录或调整服务端条目限制。' : data.entries.length + ' 个条目';
  } catch (error) { if (generation === state.generation) message(error.message, 'error'); }
}
function assignText(data) {
  const content = data.content;
  state.bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const withoutBom = state.bom ? content.slice(1) : content;
  const crlf = withoutBom.includes('\r\n');
  const withoutPairs = withoutBom.replaceAll('\r\n', '');
  if (withoutPairs.includes('\r') || (crlf && withoutPairs.includes('\n'))) throw new Error('文件使用混合或旧式换行符，请使用 VSCode 编辑，以保留原始格式');
  state.eol = crlf ? '\r\n' : '\n';
  editor.value = withoutBom.replaceAll('\r\n', '\n');
  state.original = editor.value; state.version = data.version; state.editable = true;
  $('editor-wrap').hidden = false;
  $('file-info').textContent = 'UTF-8' + (state.bom ? ' BOM' : '') + ' · ' + (crlf ? 'CRLF' : 'LF') + ' · ' + data.bytes.toLocaleString() + ' 字节';
  lineNumbers();
}
async function openFile(path) {
  if (!(await mayDiscard())) return;
  const workspace = state.workspace;
  const generation = ++state.generation;
  resetFile(); state.file = path; state.busy = true;
  $('filename').textContent = path; $('empty').hidden = true; updateControls(); renderTree();
  message('正在读取文件…');
  const query = params(path);
  setLink('download', base + 'download?' + query);
  setLink('vscode-file', '#');
  try {
    if (/\.(png|jpe?g|gif|webp|pdf)$/i.test(path)) {
      const response = await fetch(base + 'download?' + query + '&preview=1', { cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json()).error || '预览失败');
      const blob = await response.blob();
      if (generation !== state.generation || workspace !== state.workspace) return;
      const objectUrl = URL.createObjectURL(blob);
      const element = document.createElement(/\.pdf$/i.test(path) ? 'iframe' : 'img');
      element.src = objectUrl; element.title = path;
      if (element.tagName === 'IMG') element.alt = path;
      $('preview').replaceChildren(element); $('preview').hidden = false;
      const previousCleanup = state.previewCleanup; state.previewCleanup = () => URL.revokeObjectURL(objectUrl); previousCleanup?.();
      $('file-info').textContent = blob.size.toLocaleString() + ' 字节 · 预览';
      message('预览已打开；可下载文件或用 VSCode 打开。');
    } else {
      const data = await api('file', query);
      if (generation !== state.generation || workspace !== state.workspace) return;
      assignText(data); message('可编辑。保存会直接写入远程工作目录。');
    }
  } catch (error) {
    if (generation === state.generation) { state.editable = false; message(error.message, 'error'); }
  } finally { if (generation === state.generation) { state.busy = false; updateControls(); renderTree(); } }
}
async function save() {
  if (!dirty() || state.busy) return;
  const content = state.bom + (state.eol === '\r\n' ? editor.value.replaceAll('\n', '\r\n') : editor.value);
  state.busy = true; updateControls(); message('正在保存…');
  try {
    const data = await api('file', null, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-DSH-Workspace-Files': '1' }, body: JSON.stringify({ workspace: state.workspace, path: state.file, content, version: state.version }) });
    assignText(data); message('已保存到远程文件 · ' + new Date().toLocaleTimeString(), 'success');
  } catch (error) {
    message(error.message + (error.status === 409 ? ' 可先复制你的内容，再点“重新读取”。' : ' 你的编辑仍保留在此页面。'), 'error');
  } finally { state.busy = false; updateControls(); }
}
async function selectWorkspace(id) {
  if (!(await mayDiscard())) { $('workspace').value = state.workspace; return; }
  ++state.generation; resetFile(); state.previewCleanup?.(); state.previewCleanup = null;
  state.workspace = id; state.directory = ''; state.entries = []; renderTree();
  const workspace = state.workspaces.find(w => w.id === id);
  if (!workspace) return;
  $('workspace').title = workspace.path;
  message(workspace.path); setLink('vscode-folder', '#');
  await navigate('');
}
$('workspace').onchange = () => selectWorkspace($('workspace').value);
$('save').onclick = save;
$('reload').onclick = () => openFile(state.file);
$('refresh').onclick = () => navigate(state.directory);
$('filter').oninput = renderTree; $('hidden').onchange = renderTree;
async function desktopConnect(path = '') {
  if (dirty() || state.busy) { message('请先保存当前编辑，再在 VSCode 中打开。', 'error'); return; }
  if (!state.workspace) return;
  try {
    const reply = await api('desktop-ticket', null, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DSH-Workspace-Files': '1' }, body: JSON.stringify({ workspace: state.workspace, path }) });
    const dialog = $('desktop-dialog'); $('desktop-content').replaceChildren();
    const info = document.createElement('p');
    info.textContent = '允许本机 VSCode 读写当前工作目录，有效期 ' + reply.clientTokenDays + ' 天，可在“客户端授权”中撤销。请先安装配套 DSH HTTP Files 扩展。此链接 60 秒内有效。';
    const link = document.createElement('a'); link.className = 'button primary';
    link.textContent = '在本机 VSCode 中打开 ↗';
    link.href = 'vscode://ahoge-local.dsh-http-files/connect?' + new URLSearchParams({ server: location.origin, ticket: reply.ticket });
    const copy = document.createElement('button'); copy.textContent = '复制配对链接';
    copy.onclick = async () => { try { await navigator.clipboard.writeText(link.href); copy.textContent = '已复制'; } catch { message('无法复制，请直接点击打开链接', 'error'); } };
    $('desktop-content').append(info, link, copy); dialog.showModal();
    setTimeout(() => { link.removeAttribute('href'); link.textContent = '链接已过期，请关闭后重新连接'; copy.disabled = true; }, 60000);
  } catch (error) { message(error.message, 'error'); }
}
async function desktopClients() {
  try {
    const reply = await api('desktop-clients'); const content = $('desktop-content'); content.replaceChildren();
    const info = document.createElement('p'); info.textContent = '已授权的本机 VSCode 客户端（撤销后立即停止文件访问）'; content.append(info);
    if (!reply.clients.length) { const empty = document.createElement('p'); empty.textContent = '暂无有效授权'; content.append(empty); }
    for (const client of reply.clients) {
      const row = document.createElement('p'), label = document.createElement('span'), revoke = document.createElement('button');
      label.textContent = (client.title || client.workspace) + ' · ' + new Date(client.created).toLocaleString() + ' · 到期 ' + new Date(client.expires).toLocaleDateString() + ' ';
      revoke.textContent = '撤销'; revoke.onclick = async () => {
        revoke.disabled = true;
        try { await api('desktop-clients', null, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DSH-Workspace-Files': '1' }, body: JSON.stringify({ id: client.id }) }); row.remove(); }
        catch (error) { revoke.disabled = false; message(error.message, 'error'); }
      };
      row.append(label, revoke); content.append(row);
    }
    $('desktop-dialog').showModal();
  } catch (error) { message(error.message, 'error'); }
}
$('copy-command').onclick = desktopClients;
$('desktop-close').onclick = () => $('desktop-dialog').close();
$('vscode-folder').onclick = event => { event.preventDefault(); desktopConnect(); };
$('vscode-file').onclick = event => { event.preventDefault(); if (state.file) desktopConnect(state.file); };
editor.addEventListener('input', lineNumbers);
editor.addEventListener('scroll', () => { $('line-numbers').scrollTop = editor.scrollTop; });
editor.addEventListener('keydown', event => {
  if (event.key === 'Tab' && !state.busy) { event.preventDefault(); editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end'); lineNumbers(); }
});
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); } });
window.addEventListener('beforeunload', event => { if (dirty() || state.busy) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('focus', async () => {
  if (!state.file || !state.editable || state.busy) return;
  const workspace = state.workspace, path = state.file, version = state.version;
  try { const data = await api('file', params(path)); if (state.workspace === workspace && state.file === path && state.version === version && data.version !== version) { if (!dirty()) { assignText(data); message('已同步远程修改 · ' + new Date().toLocaleTimeString(), 'success'); } else message('远程文件已更新。你的未保存编辑已保留；保存前请比较最新内容。', 'error'); } }
  catch { /* The next explicit operation reports network/auth failures. */ }
});
try {
  const data = await api('workspaces'); state.workspaces = data.workspaces;
  $('ssh-info').textContent = '本机 VSCode · HTTP 文件连接';
  for (const workspace of data.workspaces) { const option = document.createElement('option'); option.value = workspace.id; option.textContent = workspace.title + ' — ' + workspace.path; $('workspace').append(option); }
  if (!data.workspaces.length) message('请先在 DSH 中添加一个工作目录，然后刷新本页。');
  else {
    const session = new URL(location.href).searchParams.get('session');
    const requestedWorkspace = new URL(location.href).searchParams.get('workspace');
    const selected = data.workspaces.find(w => w.id === requestedWorkspace) || data.workspaces.find(w => w.sessionIds.includes(session)) || data.workspaces[0];
    $('workspace').value = selected.id; await selectWorkspace(selected.id);
    const requestedPath = new URL(location.href).searchParams.get('path');
    if (requestedPath) await openFile(requestedPath);
  }
} catch (error) { message(error.message, 'error'); }
