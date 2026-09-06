const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../pocaai.js'),'utf8');
function setup(){
  const state={released:0,created:0,failPart:false,shortIndex:false,failFirstSession:false,urls:[]};
  const wasmPaths={mjs:'module.mjs',wasm:'blob:assembled-runtime'};
  const context={window:{},URL,document:{baseURI:'https://example.com/pocabinder/'},location:{},ort:{env:{wasm:{wasmPaths}},InferenceSession:{create:async()=>{state.created++;if(state.failFirstSession&&state.created===1)throw new Error('retry');return {release:async()=>state.released++};}}},fetch:async url=>{
    state.urls.push(url);
    if(url.endsWith('model_parts.json'))return {ok:true,json:async()=>({recognition:{file:'rec.onnx',parts:1,bytes:2}})};
    if(url.endsWith('.part0'))return {ok:!state.failPart,arrayBuffer:async()=>new ArrayBuffer(2)};
    if(url.endsWith('index_meta.json'))return {ok:true,json:async()=>({dim:512,count:1,scale:1,owner:[1],meta:{1:{name:'test'}}})};
    if(url.endsWith('index_vecs_int8.bin'))return {ok:true,arrayBuffer:async()=>new ArrayBuffer(state.shortIndex?1:512)};
    throw new Error('unexpected '+url);
  }};
  vm.runInNewContext(source,context);return {api:context.window.PocaAI,state,context,wasmPaths};
}
test('concurrent AI initialization shares sessions and keeps the assembled WASM path on retry',async()=>{
  const {api,state,context,wasmPaths}=setup();state.failFirstSession=true;
  await Promise.all([api.load(),api.load()]);
  assert.equal(state.created,3); // one retry + detection + recognition
  assert.equal(context.ort.env.wasm.wasmPaths,wasmPaths);
  await api.load();assert.equal(state.created,3);
});
test('missing model parts release partial sessions and a later retry recovers',async()=>{
  const {api,state}=setup();state.failPart=true;
  await assert.rejects(api.load(),/조각/);assert.equal(state.released,1);
  assert.equal(state.urls.some(u=>u.endsWith('w600k_r50_int8.onnx')),false);
  state.failPart=false;await api.load();assert.equal(api._state.ready,true);
});
test('truncated member vectors fail rather than producing false matches',async()=>{
  const {api,state}=setup();state.shortIndex=true;
  await assert.rejects(api.load(),/완전하지/);assert.equal(api._state.ready,false);assert.equal(state.released,2);
});
