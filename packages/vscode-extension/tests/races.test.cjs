const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Provider } = require('../core.cjs');
class FileSystemError extends Error { static NoPermissions(m) { return new this(m); } static Unavailable(m) { return new this(m); } }
class EventEmitter { constructor() { this.events = []; } fire(events) { this.events.push(...events); } dispose() {} }
const vscode = { FileSystemError, EventEmitter, FileChangeType: { Changed: 1, Created: 2, Deleted: 3 } };
const uri = { authority: 'test', path: '/a.txt', toString: () => 'dshfs://test/a.txt' };
test('external save during read triggers change, including older servers', async () => {
  for (const withRevision of [true, false]) {
    let content = 'original', version = 'v1';
    const bridge = { call: async route => {
      if (route === 'file') {
        const snapshot = { content, version, ...(withRevision ? { revision: version } : {}) };
        content = 'external update'; version = 'v2'; return snapshot;
      }
      return { type: 1, size: content.length, revision: version, mtime: 1, ctime: 1 };
    }};
    const provider = new Provider(vscode, async () => bridge);
    try {
      assert.equal((await provider.readFile(uri)).toString(), 'original');
      await provider.poll();
      assert.equal(provider.emitter.events.length, 1);
      assert.equal(provider.emitter.events[0].type, vscode.FileChangeType.Changed);
    } finally { provider.dispose(); }
  }
});
test('stat and watch cannot swallow external changes before polling', async () => {
  let revision = 'v1';
  const provider = new Provider(vscode, async () => ({ call: async () => ({ revision }) }));
  try {
    await provider.stat(uri);
    revision = 'v2';
    await provider.stat(uri);
    await provider.poll();
    assert.equal(provider.emitter.events.length, 1);
    revision = 'v3';
    provider.watch(uri);
    await new Promise(resolve => setImmediate(resolve));
    await provider.poll();
    assert.equal(provider.emitter.events.length, 2);
  } finally { provider.dispose(); }
});
test('a remote change immediately after PUT is still reported by polling', async () => {
  let content = 'original', revision = 'v1';
  const provider = new Provider(vscode, async () => ({ call: async (route, query, method, body) => {
    if (route === 'file' && method === 'PUT') {
      const result = { content: body.content, version: 'v2', revision: 'v2' };
      content = 'another writer'; revision = 'v3'; return result;
    }
    if (route === 'file') return { content, version: revision, revision };
    return { revision };
  }}));
  try {
    await provider.readFile(uri);
    await provider.writeFile(uri, Buffer.from('my save'), { overwrite: true });
    provider.emitter.events.length = 0;
    await provider.poll();
    assert.equal(provider.emitter.events.length, 1);
    assert.equal(provider.versions.get(uri.toString()), 'v2');
  } finally { provider.dispose(); }
});
test('directory changes during listing are reported by polling', async () => {
  let revision='v1';
  const provider=new Provider(vscode,async()=>({call:async route=>{
    if(route==='list'){revision='v2';return {entries:[],truncated:false};}
    return {revision};
  }}));
  try{assert.deepEqual(await provider.readDirectory(uri),[]);await provider.poll();assert.equal(provider.emitter.events.length,1);}finally{provider.dispose();}
});
