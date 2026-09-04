'use strict';
/** Parse file destinations on POSIX and Windows; web URLs remain ordinary links. */
function parseFileTarget(value) {
  if (typeof value !== 'string' || !value || value.length > 8192) return null;
  let file = value, line = 1, column = 1;
  if (/^file:/i.test(file)) {
    try {
      const url = new URL(file);
      if ((url.hostname && url.hostname !== 'localhost') || url.search) return null;
      file = url.pathname + url.hash;
      if (/^\/[a-z]:\//i.test(file)) file = file.slice(1);
    } catch { return null; }
  } else if (/^sandbox:\//i.test(file)) file = file.slice(8);
  else if (!/^[a-z]:[\\/]/i.test(file) && /^[a-z][a-z0-9+.-]*:/i.test(file) && !/^[^/]+:\d+(?::\d+)?$/.test(file)) return null;
  if (file.startsWith('//') || file.startsWith('\\\\') || file.startsWith('#') || file.includes('?')) return null;
  const fragment = /#L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?$/.exec(file);
  const colon = !fragment && /:(\d+)(?::(\d+))?$/.exec(file);
  const position = fragment || colon;
  if (position) { line = Number(position[1]); column = Number(position[2] || 1); file = file.slice(0, position.index); }
  try { file = decodeURIComponent(file); } catch { return null; }
  if (!file || /[\0-\x1f]/.test(file) || file.startsWith('//') || file.startsWith('\\\\') ||
      !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) return null;
  return { file, line, column };
}
function normalizeAbsolute(value, windows) {
  if (windows) value = value.replaceAll('\\', '/');
  if (windows ? !/^[a-z]:\//i.test(value) : !value.startsWith('/') || value.includes('\\')) throw new Error('无法确定远程工作目录');
  const prefix = windows ? value.slice(0, 2) : '';
  const parts = [];
  for (const p of value.slice(windows ? 3 : 1).split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') parts.pop(); else parts.push(p);
  }
  return prefix + '/' + parts.join('/');
}
function resolveTarget(value, workspaces, sessionId, cwd) {
  const target = parseFileTarget(value);
  if (!target) throw new Error('不支持此文件链接');
  const current = workspaces.find(w => w.sessionIds?.includes(sessionId));
  const base = cwd || current?.path;
  const driveAbsolute = /^[a-z]:[\\/]/i.test(target.file);
  const windows = driveAbsolute || !!(base && /^[a-z]:[\\/]/i.test(base));
  if (windows && (target.file.startsWith('/') || target.file.startsWith('\\') || /^[a-z]:(?![\\/])/i.test(target.file))) throw new Error('不支持含糊的 Windows 路径');
  const absolute = normalizeAbsolute(driveAbsolute || target.file.startsWith('/') ? target.file : (base ? base + '/' + target.file : ''), windows);
  const compare = s => windows ? s.toLowerCase() : s;
  const roots = workspaces.flatMap(w => {
    if (!!/^[a-z]:[\\/]/i.test(w.path) !== windows) return [];
    try {
      const root = normalizeAbsolute(w.path, windows).replace(/\/$/, '');
      return compare(absolute) === compare(root) || compare(absolute).startsWith(compare(root) + '/') ? [{ w, root }] : [];
    } catch { return []; }
  });
  const selected = roots.find(r => r.w === current) || roots.sort((a, b) => b.root.length - a.root.length)[0];
  if (!selected) throw new Error('该文件不在 DSH 已登记的工作目录中');
  const file = absolute.slice(selected.root.length).replace(/^\//, '');
  if (windows && file.split('/').some(p => /[<>:"|?*]/.test(p) || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p))) throw new Error('不支持 Windows 特殊路径');
  return { workspace: selected.w.workspaceId || selected.w.id, path: file, line: target.line, column: target.column };
}
module.exports = { parseFileTarget, resolveTarget };
