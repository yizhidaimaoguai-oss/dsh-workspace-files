import { spawnSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
const target = args.find(arg => !arg.startsWith('--'));
if (!target || args.some(a => a.startsWith('--') && !['--check', '--apply'].includes(a))) {
  console.error('Usage: node scripts/patch-dsh.mjs --check|--apply /path/to/deepseek-harness');
  process.exit(2);
}
const cwd = await realpath(target);
const pkg = JSON.parse(await readFile(cwd + '/package.json', 'utf8'));
if (pkg.name !== '@deepseek-ai/dsh-root') throw new Error('Target is not a DSH source checkout.');
const patch = fileURLToPath(new URL('../patches/dsh-chat-file-opener.patch', import.meta.url));
function git(extra) {
  const r = spawnSync('git', ['apply', ...extra, patch], { cwd, encoding: 'utf8' });
  if (r.error) throw r.error;
  return r;
}
const check = git(['--check']);
if (check.status !== 0) {
  if (git(['--reverse', '--check']).status === 0) {
    console.log('Patch is already applied. No changes made.');
    process.exit(0);
  }
  console.error(check.stderr);
  throw new Error('Patch does not apply cleanly. No files changed; inspect DSH compatibility.');
}
if (!args.includes('--apply')) {
  console.log('Patch applies cleanly. Run with --apply to modify the checkout.');
} else {
  const applied = git([]);
  if (applied.status !== 0) throw new Error(applied.stderr);
  console.log('Patch applied. Rebuild DSH client libraries and web frontend, then restart DSH.');
}
