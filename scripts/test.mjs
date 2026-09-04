import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const portableOnly = process.argv.includes('--portable');
const serverOnly = process.argv.includes('--server');

const files = [];
if (!serverOnly) {
  files.push('packages/dsh-workspace-files/tests/links.test.cjs');
  for (const name of await readdir(new URL('../packages/vscode-extension/tests/', import.meta.url))) {
    if (name.endsWith('.test.cjs')) files.push('packages/vscode-extension/tests/' + name);
  }
}
if (!portableOnly) {
  for (const name of await readdir(new URL('../packages/dsh-workspace-files/tests/', import.meta.url))) {
    if (name.endsWith('.test.js')) files.push('packages/dsh-workspace-files/tests/' + name);
  }
}
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
