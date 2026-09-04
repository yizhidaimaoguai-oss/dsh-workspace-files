const { test } = require('node:test');
const assert = require('node:assert/strict');
const { serverUrl, Provider, Bridge } = require('../core.cjs');
class FileSystemError extends Error {
  constructor(message) { super(message); this.code = 'Unknown'; }
  static FileNotFound() { const e = new this('missing'); e.code='FileNotFound'; return e; }
  static NoPermissions(m) { return new this(m); }
  static FileExists() { return new this('exists'); }
  static Unavailable(m) { return new this(m); }
}
class EventEmitter { constructor(){ this.events=[]; this.event = fn => { this.fn=fn; return {dispose(){}}; }; } fire(e){this.events.push(...e);this.fn?.(e);} dispose(){} }
const vscode = { FileSystemError, EventEmitter, FileChangeType:{Changed:1,Created:2,Deleted:3} };
const uri={ authority:'connection', path:'/中文.txt', toString:()=> 'dshfs://connection/中文.txt' };
test('connection rejects unsafe URLs and uses scoped bearer with redirects disabled', async () => {
  for(const s of ['http://evil.test','file:///a','http://u:p@localhost:3080','http://localhost:3080/path']) assert.throws(()=>serverUrl(s));
  assert.equal(serverUrl('http://127.0.0.1:3080/'),'http://127.0.0.1:3080');
  let seen;
  const bridge=new Bridge('http://localhost:3080','private',async(url,options)=>{seen={url,options};return{ok:true,json:async()=>({ok:true})}});
  await bridge.call('stat',{path:'中文.txt'});
  assert.equal(seen.options.headers.Authorization,'Bearer private'); assert.equal(seen.options.redirect,'error');
  assert.equal(seen.url.searchParams.get('path'),'中文.txt');
});
test('provider preserves BOM/CRLF, stale version while dirty, detects external changes and deletion', async t => {
  let content='\uFEFF中文\r\n', version='v1', dirty=false, missing=false;
  const bridge={call:async(route,query,method,body)=>{
    if(missing){const e=new Error('missing');e.status=404;throw e;}
    if(route==='stat')return{type:1,ctime:1,mtime:1,size:Buffer.byteLength(content),revision:version};
    if(route==='file'&&method==='PUT'){
      if(body.version!==version){const e=new Error('conflict');e.status=409;throw e;}
      content=body.content;version='v2';return{content,version};
    }
    return{content,version};
  }};
  const p=new Provider(vscode,async()=>bridge,()=>dirty);t.after(()=>p.dispose());
  const first=await p.readFile(uri); assert.equal(first.toString(),content);
  await p.writeFile(uri,Buffer.from('\uFEFF保存\r\n'),{overwrite:true}); assert.equal(content,'\uFEFF保存\r\n');
  dirty=true; version='external';content='external edit';
  await p.poll();assert.ok(p.emitter.events.some(e=>e.type===1));
  await p.readFile(uri); // VSCode may read disk to compare a dirty document; do not advance its save baseline.
  await assert.rejects(p.writeFile(uri,Buffer.from('stale'),{overwrite:true}),/conflict/);
  assert.equal(content,'external edit');
  missing=true;await p.poll();assert.ok(p.emitter.events.some(e=>e.type===3));
  assert.throws(()=>p.delete(uri),/不支持/);
});
