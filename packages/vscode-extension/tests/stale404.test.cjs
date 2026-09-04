const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Provider } = require('../core.cjs');
class FileSystemError extends Error {
  static FileNotFound() { const e = new this('missing'); e.code = 'FileNotFound'; return e; }
  static Unavailable(m) { return new this(m); }
}
class EventEmitter { constructor() { this.events = []; } fire(e) { this.events.push(...e); } dispose() {} }
const vscode = { FileSystemError, EventEmitter, FileChangeType: { Changed: 1, Created: 2, Deleted: 3 } };
const uri = { authority: 'connection', path: '/a.txt', toString: () => 'dshfs://connection/a.txt' };
test('a stale 404 cannot delete a newly reopened file', async () => {
  let revision = 'v1', delayNextStat = false, rejectOldStat, notifyStarted;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const bridge = { call: async route => {
    if (route === 'stat' && delayNextStat) {
      delayNextStat = false; notifyStarted();
      return new Promise((resolve, reject) => { rejectOldStat = reject; });
    }
    return route === 'stat' ? { revision } : { content: revision, version: revision, revision };
  } };
  const p = new Provider(vscode, async () => bridge);
  try {
    await p.readFile(uri);
    delayNextStat = true;
    const pendingPoll = p.poll();
    await started;
    // A 404 from a temporary disappearance is delayed in transport. The file
    // reappears, and an explicit editor refresh successfully reads the new file.
    revision = 'v2';
    assert.equal((await p.readFile(uri)).toString(), 'v2');
    const error = new Error('missing'); error.status = 404;
    rejectOldStat(error);
    await pendingPoll;
    await p.poll();
    const events = p.emitter.events.map(event => event.type);
    assert.deepEqual(events, [], 'A superseded stat must not emit Deleted for the successfully reopened file');
  } finally { p.dispose(); }
});
