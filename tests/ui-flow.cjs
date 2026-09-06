/* Optional in-memory DOM integration tests. No browser or network is launched.
   Install jsdom in a temporary directory and expose it through NODE_PATH. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
function open(page,saved){
  const dom=new JSDOM(read(page+'.html'),{url:'https://vlending.github.io/pocabinder/'+page+'.html',runScripts:'outside-only'});
  const w=dom.window;w.scrollTo=()=>{};
  if(saved)w.localStorage.setItem('pocabinder.prototype.v1',saved);
  w.eval(read('poca-data.js'));
  w.eval(read(page+'-runtime.js'));
  return {dom,w,document:w.document};
}
function mockAI(w,analyze){
  w.Image=class{constructor(){this.naturalWidth=640;this.naturalHeight=900;}set src(v){queueMicrotask(()=>this.onload());}};
  w.URL.createObjectURL=()=> 'blob:fixture';w.URL.revokeObjectURL=()=>{};
  w.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},drawImage(){}});
  w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,YQ==';
  w.__ortReady=Promise.resolve();w.ort={env:{}};
  w.PocaAI={load:async()=>{},analyze};
}
const success={faceFound:true,top:{group:'aespa',name:'카리나'},confidence:92,quality:{score:80},candidates:[]};
test('search opens the selected card, ownership changes binder, and sample never submits',()=>{
  const {dom,w,document:d}=open('app');
  w.searchArtist('V');d.querySelector('[data-card="614"]').click();
  assert.match(d.querySelector('#scr-card h1').textContent,/V/);
  d.querySelector('[data-flag="owned"]').click();w.go('binder');
  assert.equal(d.querySelectorAll('#scr-binder [data-card]').length,1);
  w.useSample();w.submitCard();
  assert.equal(w.PocaData.read().submissions.length,0);
  assert.match(d.querySelector('#complete-title').textContent,/샘플/);dom.window.close();
});
test('actual upload uses its result and saves exactly once; admin reads it and requires rejection reason',async()=>{
  const {dom,w,document:d}=open('app');mockAI(w,async()=>success);
  await w.handleFile({type:'image/jpeg',size:123,name:'test.jpg'});
  assert.equal(d.querySelector('.screen.active').id,'scr-result');
  assert.equal(d.querySelector('#input-member').value,'카리나');
  assert.equal(d.querySelector('#input-album').value,'');
  w.submitCard();w.submitCard();assert.equal(w.PocaData.read().submissions.length,1);
  assert.match(d.querySelector('#complete-title').textContent,/브라우저/);
  const id=w.PocaData.read().submissions[0].id;
  const admin=open('admin',w.localStorage.getItem(w.PocaData.key));admin.w.openDetail(id);
  admin.document.querySelector('[data-review="rejected"]').click();assert.equal(admin.w.PocaData.read().reviews[id],undefined);
  admin.document.querySelector('#review-reason').value='멤버 확인 필요';admin.document.querySelector('[data-review="rejected"]').click();
  assert.equal(admin.w.PocaData.read().reviews[id].status,'rejected');
  assert.equal(admin.document.querySelector('.screen.active').id,'scr-admin');
  admin.w.openDetail(id);admin.document.querySelector('[data-undo]').click();assert.equal(admin.w.PocaData.read().reviews[id],undefined);
  dom.window.close();admin.dom.window.close();
});
test('an older analysis cannot replace a newer photo result',async()=>{
  const {dom,w,document:d}=open('app');let finishFirst;let started;
  const firstStarted=new Promise(r=>started=r);let count=0;
  mockAI(w,async()=>{count++;if(count===1){started();return new Promise(r=>finishFirst=r);}return {...success,top:{group:'방탄소년단',name:'V'}};});
  const first=w.handleFile({type:'image/jpeg',size:123,name:'first.jpg'});await firstStarted;
  await w.handleFile({type:'image/jpeg',size:123,name:'second.jpg'});
  finishFirst(success);await first;
  assert.equal(d.querySelector('#input-member').value,'V');assert.equal(d.querySelector('#up-result [data-fname]').textContent,'second.jpg');dom.window.close();
});
test('cancelling analysis prevents delayed navigation to results',async()=>{
  const {dom,w,document:d}=open('app');let finish,started;const ready=new Promise(r=>started=r);
  mockAI(w,async()=>{started();return new Promise(r=>finish=r);});
  const task=w.handleFile({type:'image/jpeg',size:123,name:'cancel.jpg'});await ready;w.go('home');finish(success);await task;
  assert.equal(d.querySelector('.screen.active').id,'scr-home');dom.window.close();
});
test('AI failure shows error instead of a fabricated sample; manual entry remains possible',async()=>{
  const {dom,w,document:d}=open('app');mockAI(w,async()=>{throw new Error('모델 실행 실패');});
  await w.handleFile({type:'image/jpeg',size:123,name:'failed.jpg'});
  assert.equal(d.querySelector('.screen.active').id,'scr-scan');assert.match(d.querySelector('#dz-err').textContent,/모델 실행 실패/);
  w.startManual();assert.equal(d.querySelector('#input-member').value,'');
  w.submitCard();assert.equal(w.PocaData.read().submissions.length,0);dom.window.close();
});
test('unsupported and oversized images fail before loading AI',async()=>{
  const {dom,w,document:d}=open('app');
  await w.handleFile({type:'image/heic',size:123,name:'phone.heic'});assert.match(d.querySelector('#dz-err').textContent,/HEIC/);
  await w.handleFile({type:'image/jpeg',size:11*1024*1024,name:'large.jpg'});assert.match(d.querySelector('#dz-err').textContent,/10MB/);
  dom.window.close();
});
