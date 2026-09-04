import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
function node(script, args = [], cwd = root, capture = false) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr || 'Build command failed: ' + script);
  return r.stdout;
}
node(path.join(root, 'scripts/build.mjs'));
node(path.join(root, 'scripts/check.mjs'));
await mkdir(dist, { recursive: true });
if (!process.env.npm_execpath) throw new Error('Run through npm run package.');
const raw = node(process.env.npm_execpath, ['pack', './packages/dsh-workspace-files', '--pack-destination', dist, '--json'], root, true);
const packed = JSON.parse(raw);
const forbidden = /(?:tests\/|\.env|clients\.json|cookie|\.vsix|\.git\/|node_modules\/)/i;
for (const file of packed[0].files) if (forbidden.test(file.path)) throw new Error('Unexpected npm payload: ' + file.path);
const vsceRoot = path.join(root, 'node_modules/@vscode/vsce');
const vsceMeta = JSON.parse(await readFile(path.join(vsceRoot, 'package.json'), 'utf8'));
const extRoot = path.join(root, 'packages/vscode-extension');
const ext = JSON.parse(await readFile(path.join(extRoot, 'package.json'), 'utf8'));
const vsix = path.join(dist, ext.name + '-' + ext.version + '.vsix');
node(path.resolve(vsceRoot, typeof vsceMeta.bin === 'string' ? vsceMeta.bin : vsceMeta.bin.vsce),
  ['package', '--no-dependencies', '--allow-missing-repository', '--out', vsix], extRoot);
const artifacts = [packed[0].filename, path.basename(vsix)];
const checksums = [];
for (const name of artifacts) checksums.push(createHash('sha256').update(await readFile(path.join(dist, name))).digest('hex') + '  ' + name);
await writeFile(path.join(dist, 'SHA256SUMS'), checksums.join('\n') + '\n');
console.log('Release artifacts: ' + artifacts.join(', ') + ', SHA256SUMS');
