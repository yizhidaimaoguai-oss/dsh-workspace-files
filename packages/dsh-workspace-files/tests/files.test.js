import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, symlink, link, rm, stat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readText, saveText, listFiles, readBytes, vscodeLinks, validatePath, statFile } from '../files.js';
import { apply } from '../index.js';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-files-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test('Chinese paths, exact UTF-8 BOM/CRLF round trip and file mode preservation', async t => {
  const root = await fixture(t); await mkdir(join(root, '中文 文件'));
  const path = '中文 文件/测试 #1.md';
  await writeFile(join(root, path), '\uFEFF第一行\r\n第二行\r\n', { mode: 0o640 });
  await chmod(join(root, path), 0o640);
  const before = await readText(root, path, 4096);
  assert.equal(before.content, '\uFEFF第一行\r\n第二行\r\n');
  const after = await saveText(root, path, before.content + '第三行\r\n', before.version, 4096);
  assert.equal(await readFile(join(root, path), 'utf8'), after.content);
  assert.notEqual(after.version, before.version);
  if (process.platform !== 'win32') assert.equal((await stat(join(root, path))).mode & 0o777, 0o640);
});
test('external edit rejects stale saves and preserves newer data', async t => {
  const root = await fixture(t); await writeFile(join(root, 'a.txt'), 'original');
  const before = await readText(root, 'a.txt', 1024);
  await writeFile(join(root, 'a.txt'), 'changed by VSCode');
  await assert.rejects(saveText(root, 'a.txt', 'stale browser', before.version, 1024), { status: 409 });
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'changed by VSCode');
});
test('concurrent browser saves with the same version admit exactly one writer', async t => {
  const root = await fixture(t); await writeFile(join(root, 'a.txt'), 'start');
  const before = await readText(root, 'a.txt', 1024);
  const results = await Promise.allSettled(['first', 'second'].map(text => saveText(root, 'a.txt', text, before.version, 1024)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
});
test('rejects traversal, symlinks, hard-link writes, binary and oversized files', async t => {
  const root = await fixture(t); await writeFile(join(root, 'text'), 'abc');
  const outside = await fixture(t); await writeFile(join(outside, 'secret'), 'outside');
  await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await link(join(root, 'text'), join(root, 'hard'));
  await writeFile(join(root, 'binary'), Buffer.from([0, 1, 2]));
  await writeFile(join(root, 'invalid'), Buffer.from([255, 254]));
  for (const path of ['../etc/passwd', '/etc/passwd', 'escape/secret']) await assert.rejects(readText(root, path, 1024), { status: 403 });
  for (const path of ['binary', 'invalid']) await assert.rejects(readText(root, path, 1024), { status: 415 });
  await assert.rejects(readText(root, 'text', 2), { status: 413 });
  const before = await readText(root, 'hard', 1024);
  await assert.rejects(saveText(root, 'hard', 'change', before.version, 1024), { status: 409 });
  assert.equal((await readBytes(root, 'binary', 1024)).length, 3);
});
test('directory listing identifies unsupported links and signals truncation', async t => {
  const root = await fixture(t); await mkdir(join(root, 'folder')); await writeFile(join(root, 'a'), 'a');
  await symlink(join(root, 'folder'), join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await listFiles(root, '', 10);
  assert.equal(result.entries[0].type, 'directory');
  assert.equal(result.entries.find(e => e.name === 'link').type, 'other');
  assert.equal((await listFiles(root, '', 1)).truncated, true);
});
test('VSCode links encode spaces, Unicode and shell-sensitive file names', () => {
  const result = vscodeLinks('dev@example-host', '/home/dev', '中文/$a #1.md');
  assert.equal(result.uri, 'vscode://vscode-remote/ssh-remote+dev@example-host/home/dev/%E4%B8%AD%E6%96%87/%24a%20%231.md');
  assert.ok(result.command.startsWith('code --file-uri "vscode-remote://'));
});
test('host routes use Connection; writes require same origin, custom header and registered workspace', async t => {
  const root = await fixture(t); await writeFile(join(root, 'a.txt'), 'original');
  const routes = new Map();
  await apply({ effect: fn => fn(), webServer: { register: () => () => {} }, connection: { fetch: { register(route) { assert.equal(routes.has(route.path), false); routes.set(route.path, route); } } }, workspaceRegistry: { list: () => [{ id: 'w', path: root, title: 'test', sessionIds: [] }], get: id => id === 'w' ? { path: root } : undefined } }, { sshTarget: 'test', maxFileBytes: 100, clientStateFile: join(root, 'clients.json') });
  const route = routes.get('/api/workspace-files/file');
  assert.deepEqual(route.methods, ['GET', 'PUT']);
  const url = 'http://dsh.internal/api/workspace-files/file';
  const before = await readText(root, 'a.txt', 100);
  const payload = { workspace: 'w', path: 'a.txt', content: 'saved', version: before.version };
  const request = (origin, extra = {}) => new Request(url, { method: 'PUT', headers: { host: 'localhost:3080', origin, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(payload) });
  assert.equal((await route.fetch(request('http://attacker.example', { 'X-DSH-Workspace-Files': '1' }))).status, 403);
  assert.equal((await route.fetch(request('http://localhost:3080'))).status, 403);
  assert.equal((await route.fetch(request('http://localhost:3080', { 'X-DSH-Workspace-Files': '1' }))).status, 200);
  assert.equal((await route.fetch(new Request(url + '?workspace=unknown&path=a.txt'))).status, 404);
  assert.equal((await route.fetch(request('http://localhost:3080', { 'X-DSH-Workspace-Files': '1' }))).status, 409);
});

test('Windows rejects drive-relative paths, ADS, devices and ambiguous names', () => {
  for (const value of ['C:/outside', 'C:outside', '../outside', '..\\outside', 'file.txt:secret', 'NUL', 'con.txt', 'dir/LPT1.log', 'trailing.', 'trailing ', '//server/share', '\\\\?\\C:\\test']) assert.throws(() => validatePath(value, 'win32'), { status: 403 }, value);
  assert.equal(validatePath('中文/file.txt', 'win32'), '中文/file.txt');
});
test('directory stat and Windows case aliases preserve one save queue', async t => {
  const root = await fixture(t);
  assert.equal((await statFile(root, '')).type, 2);
  await writeFile(join(root, 'Mixed.txt'), 'start');
  const before = await readText(root, 'Mixed.txt', 1024);
  try { await stat(join(root, 'mixed.TXT')); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const results = await Promise.allSettled(['Mixed.txt', 'mixed.TXT'].map((p, i) => saveText(root, p, 'writer ' + i, before.version, 1024)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
});
