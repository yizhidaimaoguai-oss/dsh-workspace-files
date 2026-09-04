import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full)); else files.push(full);
  }
  return files;
}
for (const file of await walk(root)) {
  const relative = path.relative(root, file);
  const text = await readFile(file, 'utf8');
  if (/\.(?:js|cjs|mjs)$/.test(file) && !file.endsWith('client.template.js')) {
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (check.status !== 0) throw new Error(relative + '\n' + check.stderr);
  }
  if (/(?:\/home\/(?!dev(?:\/|$))[^/\s]+\/|[A-Z]:[\\/]Users[\\/])/i.test(text)) {
    throw new Error('Machine-specific home path in ' + relative);
  }
  if (/100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+/.test(text)) {
    throw new Error('Private tailnet address in ' + relative);
  }
  if (/-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----|(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/.test(text)) {
    throw new Error('Possible credential in ' + relative);
  }
}
const plugin = path.join(root, 'packages/dsh-workspace-files');
const template = await readFile(path.join(plugin, 'client.template.js'), 'utf8');
const parser = (await readFile(path.join(plugin, 'link-target.cjs'), 'utf8')).replace(/module\.exports = .*;\n?$/, '');
const expected = template.replace('/* LINK_TARGET_IMPLEMENTATION */', parser);
if ((await readFile(path.join(plugin, 'client.js'), 'utf8')) !== expected) throw new Error('Stale client.js; run npm run build.');
for (const pkg of ['dsh-workspace-files', 'vscode-extension']) {
  const meta = JSON.parse(await readFile(path.join(root, 'packages', pkg, 'package.json'), 'utf8'));
  if (!meta.version || meta.license !== 'MIT') throw new Error('Invalid package metadata: ' + pkg);
}
const vscode = JSON.parse(await readFile(path.join(root, 'packages/vscode-extension/package.json'), 'utf8'));
const id = vscode.publisher + '.' + vscode.name;
for (const file of ['client.js', 'public/app.js']) {
  if (!(await readFile(path.join(plugin, file), 'utf8')).includes('vscode://' + id + '/')) throw new Error('VSCode extension ID mismatch in ' + file);
}
console.log('Source syntax, generated client, package metadata and machine-data checks passed.');
