const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../poca-data.js'),'utf8');
function setup(storage){
  const memory=storage||new Map();
  const context={localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)}};
  vm.runInNewContext(source,context);
  return {D:context.PocaData,memory,context};
}
const record={id:'local-test-1',artist:'방탄소년단',member:'정국',album:'GOLDEN',type:'앨범포카',version:'',image:'data:image/jpeg;base64,YQ==',confidence:91};
test('search supports Korean, aliases, album, type and empty results',()=>{
  const {D}=setup(),s=D.read();
  assert.equal(D.search('bts','전체',s).length,6);
  assert.equal(D.search(' GOLDEN ','전체',s)[0].id,'615');
  assert.equal(D.search('방탄소년단','MD',s)[0].member,'진');
  assert.equal(D.search('존재하지않는카드','전체',s).length,0);
});
test('ownership and wish persist across page instances without sharing flags between cards',()=>{
  const {D,memory}=setup();D.toggle('615','owned');D.toggle('614','wish');
  const next=setup(memory).D,s=next.read();
  assert.equal(next.flags('615',s).owned,true);
  assert.equal(next.flags('615',s).wish,false);
  assert.equal(next.flags('614',s).wish,true);
  assert.equal(next.toggle('615','owned'),false);
});
test('submission becomes one local binder card and one pending admin row, even on duplicate clicks',()=>{
  const {D,memory}=setup();D.submit(record);D.submit(record);
  const admin=setup(memory).D,s=admin.read();
  assert.equal(s.submissions.length,1);
  assert.equal(admin.queue(s).filter(c=>c.id===record.id).length,1);
  assert.equal(admin.flags(record.id,s).owned,true);
  assert.equal(s.submissions[0].status,'pending');
});
test('reject requires a reason, merge requires another existing card, and double review is rejected',()=>{
  const {D}=setup();D.submit(record);
  assert.throws(()=>D.review(record.id,'rejected',' '),/사유/);
  assert.throws(()=>D.review(record.id,'merged','','nonexistent'),/기존 포카/);
  assert.throws(()=>D.review('sample-614','merged','','614'),/기존 포카/);
  D.review(record.id,'rejected','반사광으로 멤버 확인 불가');
  assert.equal(D.read().reviews[record.id].status,'rejected');
  assert.throws(()=>D.review(record.id,'approved',''),/이미 처리/);
  D.undo(record.id);assert.equal(D.read().reviews[record.id],undefined);
  D.review(record.id,'merged','동일 버전 확인','615');
  assert.equal(D.read().reviews[record.id].target,'615');
});
test('failed writes never appear as successful persistence',()=>{
  const {D,context}=setup();context.localStorage.setItem=()=>{throw new Error('QuotaExceededError');};
  assert.throws(()=>D.submit(record),/저장하지 못/);
  assert.equal(D.read().submissions.length,0);
  assert.throws(()=>D.toggle('615','wish'),/저장하지 못/);
  assert.equal(D.flags('615',D.read()).wish,false);
});
test('corrupt state is preserved and not silently overwritten',()=>{
  const {D,memory}=setup();memory.set(D.key,'{invalid');
  assert.throws(()=>D.read(),/기존 데이터 보호/);
  assert.throws(()=>D.toggle('615','owned'),/기존 데이터 보호/);
  assert.equal(memory.get(D.key),'{invalid');
});
test('markup is escaped and executable image URLs cannot be submitted',()=>{
  const {D}=setup();assert.equal(D.escape('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.throws(()=>D.submit({...record,image:'javascript:alert(1)'}),/사진/);
  assert.throws(()=>D.submit({...record,id:'local-\" onclick=\"alert(1)'}),/입력/);
});
