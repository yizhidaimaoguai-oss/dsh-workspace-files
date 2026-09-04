const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseFileTarget,resolveTarget}=require('../link-target.cjs');
const workspaces=[{workspaceId:'w',path:'/home/dev/project',sessionIds:['s']},{workspaceId:'other',path:'/home/dev/other',sessionIds:['t']}];
test('file links retain Chinese names, line numbers and reference fragments',()=>{
  assert.deepEqual(resolveTarget('src/中文%20文件.ts#L12C3-L14',workspaces,'s'),{workspace:'w',path:'src/中文 文件.ts',line:12,column:3});
  assert.deepEqual(resolveTarget('file:///home/dev/project/a.ts:4:2',workspaces,'s'),{workspace:'w',path:'a.ts',line:4,column:2});
  assert.equal(resolveTarget('/home/dev/other/a.txt',workspaces,'s').workspace,'other');
  assert.equal(resolveTarget('../a.txt',workspaces,'s','/home/dev/project/sub').path,'a.txt');
  assert.equal(resolveTarget('sandbox:/home/dev/project/a.md',workspaces,'s').path,'a.md');
});
test('external links and paths outside registered workspaces cannot open local files',()=>{
  for(const value of ['https://example.com/a.md','mailto:a@b.com','javascript:alert(1)','command:workbench.action.terminal.new','//evil/a','#footnote','file://evil/a','a?token=x'])assert.equal(parseFileTarget(value),null,value);
  assert.throws(()=>resolveTarget('../../etc/passwd',workspaces,'s'),/登记/);
  assert.throws(()=>resolveTarget('/home/dev/project-sibling/a',workspaces,'s'),/登记/);
  assert.throws(()=>resolveTarget('a.txt',workspaces,'unknown'),/工作目录/);
  assert.equal(parseFileTarget('a.md#L0'),null);
});

test('Windows absolute paths and file URLs resolve across client operating systems',()=>{
  const roots=[{id:'win',path:'C:\\Projects\\Demo',sessionIds:['win-session']}];
  assert.deepEqual(resolveTarget('c:\\projects\\demo\\src\\中文.ts:12:3',roots,'win-session'),{workspace:'win',path:'src/中文.ts',line:12,column:3});
  assert.equal(resolveTarget('file:///C:/Projects/Demo/a%20b.ts#L4',roots,'win-session').path,'a b.ts');
  assert.equal(resolveTarget('src\\main.ts',roots,'win-session').path,'src/main.ts');
  for(const input of ['D:/outside/a','C:/Projects/Demo-sibling/a','C:/Projects/Demo/a.txt:secret','C:/Projects/Demo/NUL','C:relative','\\\\server\\share\\a']) assert.throws(()=>resolveTarget(input,roots,'win-session'));
});
