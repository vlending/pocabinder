(function () {
  'use strict';
  var D=window.PocaData, e=D.escape, $=function(s){return document.querySelector(s);};
  var state=D.empty(), selected='615', artist='', type='전체', query='', albumState='all', binderState='owned';
  var generation=0, photo=null, result=null, sample=false, savedId=null, enginePromise=null, toastTimer;
  function refresh() { try { state=D.read(); } catch(err) { storageError(err.message); } }
  function storageError(msg) { var n=$('#storage-status');n.hidden=false;n.textContent=msg; }
  window.showToast=function(msg){var t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.classList.remove('show');},4000);};
  function safely(fn){try{fn();}catch(err){showToast(err.message);}}
  function cardImage(c){
    var image=c.image&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(c.image)?c.image:null;
    return '<span class="poca photo '+(c.sample?'ph-'+e(c.id):'')+'"'+(image?' style="background-image:url('+image+')"':'')+'><span class="nm">'+e(c.member)+'</span></span>';
  }
  function grid(cards){return cards.length?cards.map(function(c){var f=D.flags(c.id,state);return '<button class="catalog-card" data-card="'+e(c.id)+'">'+cardImage(c)+'<span class="meta"><small>'+e(c.artist)+'</small><b>'+e(c.member)+'</b><small>'+e(c.album||'앨범 미확인')+' · '+e(c.type||'유형 미확인')+'</small><br><small>'+(f.owned?'✔ 보유 ':'')+(f.wish?'♡ 위시 ':'')+(c.sample?'예시 카드':'내가 등록한 카드')+'</small></span></button>';}).join(''):'<div class="empty-state">아직 포카가 없어요.<br>검색 조건을 바꾸거나 포카를 등록해 보세요.</div>';}
  window.go=function(name,arg,replace){
    if(!document.getElementById('scr-'+name)) name='home';
    if(name!=='analyzing') generation++;
    if((name==='result'&&!result)||(name==='complete'&&!savedId&&!sample)) name='scan';
    if(arg!=null){if(name==='card')selected=arg;else if(name==='artist'||name==='album')artist=arg;}
    document.querySelectorAll('.screen').forEach(function(s){s.classList.toggle('active',s.id==='scr-'+name);});
    var route=name+(arg!=null?'/'+encodeURIComponent(arg):'');
    if(location.hash!=='#'+route) history[replace?'replaceState':'pushState'](null,'','#'+route);
    document.querySelectorAll('.proto-nav button').forEach(function(b){var on=b.dataset.nav===name;b.classList.toggle('on',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    refresh();
    if(name==='search')renderSearch();
    if(name==='card')renderCard();
    if(name==='artist'||name==='album')renderArtist(name);
    if(name==='binder')renderBinder();
    var h=document.querySelector('#scr-'+name+' h1');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}
    window.scrollTo({top:0,behavior:'instant'});
  };
  function restoreRoute(){var parts=location.hash.slice(1).split('/'),arg='';try{arg=parts[1]?decodeURIComponent(parts[1]):null;}catch(_){}go(parts[0]||'home',arg,true);}
  window.addEventListener('popstate',restoreRoute);
  function renderSearch(){
    var cards=D.search(query,type,state);
    $('#search-count').textContent=(query?'“'+query+'” · ':'')+cards.length+'장 · 예시 카드와 이 브라우저의 등록 카드';
    $('#search-results').innerHTML=grid(cards);
    document.querySelectorAll('[data-type]').forEach(function(b){b.classList.toggle('on',b.dataset.type===type);b.setAttribute('aria-pressed',b.dataset.type===type);});
  }
  window.searchCards=function(event){if(event)event.preventDefault();query=$('#search-input').value.trim();renderSearch();};
  window.searchArtist=function(name){query=name;type='전체';$('#search-input').value=name;go('search');};
  function renderCard(){
    var c=D.card(selected,state);if(!c){$('#scr-card').innerHTML='<h1>포카를 찾지 못했어요</h1><button class="btn" onclick="go(\'search\')">검색으로 돌아가기</button>';return;}
    var f=D.flags(c.id,state),status=state.reviews[c.id];
    $('#scr-card').innerHTML='<button class="btn btn-ghost" onclick="go(\'search\')">← 포카 검색</button><h1 style="margin-top:20px">'+e(c.member)+' · '+e(c.type||'유형 미확인')+'</h1><p class="sub">'+(c.sample?'제보 이미지 기반 예시 카드 · 앨범 정보는 확인이 필요합니다.':'이 브라우저에만 저장된 포카 · '+statusText(status&&status.status))+'</p><div class="card-wrap"><div>'+cardImage(c)+'<div class="toggle-row"><button class="tgl '+(f.owned?'on-own':'')+'" data-flag="owned" aria-pressed="'+!!f.owned+'">'+(f.owned?'✔ 보유중':'보유 체크')+'</button><button class="tgl '+(f.wish?'on-wish':'')+'" data-flag="wish" aria-pressed="'+!!f.wish+'">'+(f.wish?'♥ 위시 담김':'♡ 위시')+'</button></div></div><div class="panel">'+['artist','member','album','type','version'].map(function(k,i){return '<div class="kv"><span class="k">'+['아티스트','멤버','앨범','유형','버전'][i]+'</span><span class="v">'+e(c[k]||'미확인')+'</span></div>';}).join('')+'<p class="sub">보유·위시는 현재 브라우저에 저장됩니다. 기기를 바꾸거나 브라우저 데이터를 삭제하면 이어서 볼 수 없습니다.</p></div></div>';
  }
  function statusText(s){return {approved:'검수 승인 (체험)',rejected:'반려 (체험)',merged:'병합 (체험)'}[s]||'검수 대기 (체험)';}
  function renderArtist(name){
    var cards=D.all(state).filter(function(c){return !artist||c.artist===artist;});
    var total=cards.length,owned=cards.filter(function(c){return D.flags(c.id,state).owned;}).length;
    cards=cards.filter(function(c){var f=D.flags(c.id,state);return albumState==='all'||(albumState==='owned'&&f.owned)||(albumState==='wish'&&f.wish)||(albumState==='missing'&&!f.owned);});
    document.getElementById('scr-'+name).innerHTML='<h1>'+e(artist||'전체 아티스트')+'</h1><p class="sub">등록된 예시·내 포카 '+total+'장 중 보유 '+owned+'장 · 앨범 미확인 카드 포함</p><div class="filter-tabs">'+[['all','전체'],['owned','보유'],['wish','위시'],['missing','미보유']].map(function(r){return '<button data-album-filter="'+r[0]+'" class="'+(albumState===r[0]?'on':'')+'" aria-pressed="'+(albumState===r[0])+'">'+r[1]+'</button>';}).join('')+'</div><div class="srch-grid">'+grid(cards)+'</div>';
  }
  function renderBinder(){
    var all=D.all(state),owned=all.filter(function(c){return D.flags(c.id,state).owned;}),wish=all.filter(function(c){return D.flags(c.id,state).wish;});
    var cards=binderState==='owned'?owned:binderState==='wish'?wish:state.submissions;
    $('#scr-binder').innerHTML='<h1>내 바인더 💗</h1><p class="sub">보유·위시·등록 내역은 이 브라우저에만 저장됩니다.</p><div class="binder-stats"><div class="stat"><div class="k">보유</div><div class="v">'+owned.length+'</div></div><div class="stat"><div class="k">위시</div><div class="v">'+wish.length+'</div></div><div class="stat"><div class="k">직접 등록</div><div class="v">'+state.submissions.length+'</div></div></div><div class="binder-tabs">'+[['owned','보유 포카'],['wish','위시리스트'],['submitted','등록 내역']].map(function(r){return '<button data-binder="'+r[0]+'" class="'+(binderState===r[0]?'on':'')+'" aria-pressed="'+(binderState===r[0])+'">'+r[1]+'</button>';}).join('')+'</div><div class="srch-grid">'+grid(cards)+'</div>';
  }
  document.addEventListener('click',function(event){
    var b=event.target.closest('[data-card],[data-type],[data-flag],[data-album-filter],[data-binder]');if(!b)return;
    if(b.dataset.card){selected=b.dataset.card;go('card',selected);}
    if(b.dataset.type){type=b.dataset.type;renderSearch();}
    if(b.dataset.flag)safely(function(){var on=D.toggle(selected,b.dataset.flag);refresh();renderCard();showToast(on?'이 브라우저에 저장했어요.':'목록에서 해제했어요.');});
    if(b.dataset.albumFilter){albumState=b.dataset.albumFilter;renderArtist(document.querySelector('.screen.active').id.replace('scr-',''));}
    if(b.dataset.binder){binderState=b.dataset.binder;renderBinder();}
  });
  window.addEventListener('storage',function(event){if(event.key===D.key){refresh();var active=$('.screen.active').id;if(active==='scr-binder')renderBinder();if(active==='scr-card')renderCard();if(active==='scr-search')renderSearch();}});
  window.dzErr=function(msg){var el=$('#dz-err');el.textContent=msg;el.style.display=msg?'block':'none';};
  function progress(msg){$('#analysis-status').textContent=msg;}
  async function prepareRuntime(){
    if(!window.ort||!window.PocaAI)throw new Error('AI 실행 파일을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
    if(!window.__ortReady){
      window.__ortReady=(async function(){
        var here=new URL('./',document.baseURI).href;
        ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.logLevel='error';
        var response=await fetch(here+'model_parts.json');if(!response.ok)throw new Error('AI 파일 목록을 불러오지 못했습니다.');
        var spec=(await response.json()).wasm,buffer=new Uint8Array(spec.bytes),offset=0;
        for(var i=0;i<spec.parts;i++){var r=await fetch(here+spec.file+'.part'+i);if(!r.ok)throw new Error('AI 실행 파일 다운로드 실패');var bytes=new Uint8Array(await r.arrayBuffer());buffer.set(bytes,offset);offset+=bytes.length;}
        if(offset!==spec.bytes)throw new Error('AI 실행 파일이 완전하지 않습니다.');
        ort.env.wasm.wasmPaths={mjs:here+'ort-wasm-simd-threaded.mjs',wasm:URL.createObjectURL(new Blob([buffer],{type:'application/wasm'}))};
      })().catch(function(err){window.__ortReady=null;throw err;});
    }
    await window.__ortReady;
  }
  async function ensureAI(){
    if(!enginePromise)enginePromise=(async function(){await prepareRuntime();await PocaAI.load({baseUrl:'./',onProgress:function(msg,pct){if($('#scr-analyzing').classList.contains('active'))progress(msg+' · '+Math.round(pct*100)+'%');}});})().catch(function(err){enginePromise=null;throw err;});
    return enginePromise;
  }
  function decode(file){return new Promise(function(resolve,reject){var url=URL.createObjectURL(file),img=new Image();img.onload=function(){URL.revokeObjectURL(url);resolve(img);};img.onerror=function(){URL.revokeObjectURL(url);reject(new Error('사진을 읽지 못했어요. JPG·PNG·WEBP 파일로 다시 선택해 주세요.'));};img.src=url;});}
  function resize(img,size){var w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,scale=Math.min(1,size/Math.max(w,h));var c=document.createElement('canvas');c.width=Math.max(1,Math.round(w*scale));c.height=Math.max(1,Math.round(h*scale));var ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);return c;}
  function setPhoto(image,name){['#up-analyzing','#up-result'].forEach(function(sel){var p=$(sel);p.style.backgroundImage=image?'url('+image+')':'';var label=p.querySelector('[data-fname]');if(label)label.textContent=name;});}
  window.handleFile=async function(file){
    if(!file)return;
    dzErr('');
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){dzErr('JPG·PNG·WEBP만 지원합니다. HEIC 사진은 JPG로 변환해 주세요.');return;}
    if(file.size>10*1024*1024||file.size===0){dzErr('0바이트보다 크고 10MB 이하인 사진을 선택해 주세요.');return;}
    var run=++generation;result=null;photo=null;sample=false;savedId=null;$('#manual-entry').hidden=true;
    go('analyzing');progress('사진을 준비하고 있습니다.');
    try{
      var img=await decode(file);if(run!==generation)return;
      if(img.naturalWidth*img.naturalHeight>40000000)throw new Error('사진 해상도가 너무 큽니다. 4,000만 화소 이하로 줄여 주세요.');
      var canvas=resize(img,1280);photo={id:'local-'+crypto.randomUUID(),name:file.name,image:resize(img,640).toDataURL('image/jpeg',0.82)};
      setPhoto(photo.image,file.name);progress('처음 실행할 때 AI 파일 약 66MB를 내려받습니다.');
      await ensureAI();if(run!==generation)return;
      var r=await PocaAI.analyze(canvas,function(stage){if(run===generation)progress({detect:'사진 속 얼굴을 찾고 있습니다.',embed:'얼굴 특징을 분석하고 있습니다.',match:'아티스트·멤버 후보를 비교하고 있습니다.',quality:'사진 품질을 확인하고 있습니다.'}[stage]||'분석 중입니다.');});
      if(run!==generation)return;
      result=r;renderResult();go('result');
    }catch(err){if(run!==generation)return;go('scan');dzErr(err.message);$('#manual-entry').hidden=!photo;}
  };
  window.startManual=function(){if(!photo)return;generation++;sample=false;result={faceFound:false,manual:true};renderResult();go('result');};
  window.useSample=function(){generation++;sample=true;savedId=null;photo=null;result={faceFound:true,top:{group:'방탄소년단',name:'정국'},confidence:98,quality:{score:96},sample:true};setPhoto(null,'예시 카드 #615');renderResult();go('result');};
  function renderResult(){
    var r=result,top=r.top||{},known=r.faceFound&&top.name;
    $('#result-mode').textContent=sample?'예시 결과 · 실제 분석 아님':'분석 결과를 확인해 주세요';
    $('#conf-ring').innerHTML='<b>'+(known?e(r.confidence):'—')+'</b>';
    $('#conf-title').textContent=sample?'샘플 결과 · 실제 사진 분석과 구분됩니다':known?'멤버 후보 점수 '+r.confidence+'/100 · 직접 확인 필요':'멤버를 확정하지 못했어요 · 직접 입력할 수 있어요';
    $('#conf-sub').textContent='후보 점수는 정답 확률이 아닙니다. 멤버 인식만으로 카드 등록을 자동 승인하지 않습니다.';
    $('#pill-dup').textContent='동일 포토카드 중복 여부: 미확인';
    $('#pill-quality').textContent=r.quality?'사진 품질 참고 점수 '+r.quality.score+'/100':'사진 품질: 직접 확인 필요';
    var values=[known?top.group:'',known?top.name:'',sample?'GOLDEN':'',sample?'앨범포카':'',sample?'스탠다드':''];
    ['artist','member','album','type','version'].forEach(function(k,i){var field=$('#fd-'+k+' .v');field.replaceChildren();var input=document.createElement('input');input.id='input-'+k;input.value=values[i]||'';input.maxLength=100;input.setAttribute('aria-label',['아티스트 (필수)','멤버 (필수)','앨범','유형','버전'][i]);input.placeholder=i<2?'필수 입력':'미확인 · 선택 입력';field.append(input);var pc=$('#fd-'+k+' .pc');if(pc)pc.textContent=i<2&&known?r.confidence+'/100':'—';var bar=$('#fd-'+k+' .bar i');if(bar)bar.style.width=i<2&&known?r.confidence+'%':'0';});
    $('#up-result [data-uname]').textContent=known?top.name:'직접 확인';
    $('#submit-button').disabled=false;
    $('#submit-button').textContent=sample?'샘플 체험 완료':'내 브라우저에 등록';
  }
  window.submitCard=function(){
    if(!result)return;
    if(sample){$('#complete-title').textContent='샘플 체험을 마쳤어요';$('#complete-description').textContent='예시 화면을 확인했습니다. 실제 사진을 올리면 AI 인식과 내 바인더 등록을 이어갈 수 있어요.';go('complete');return;}
    if(!photo||savedId)return;
    var record=Object.assign({},photo,{confidence:result.faceFound?result.confidence:null});
    ['artist','member','album','type','version'].forEach(function(k){record[k]=$('#input-'+k).value.trim();});
    if(!record.artist||!record.member){showToast('아티스트와 멤버를 입력해 주세요.');$('#input-'+(!record.artist?'artist':'member')).focus();return;}
    var button=$('#submit-button');button.disabled=true;
    try{
      savedId=D.submit(record);refresh();$('#complete-title').textContent='이 브라우저에 등록했어요';
      $('#complete-description').textContent=record.artist+' · '+record.member+' 포카가 내 바인더와 같은 브라우저의 관리자 체험 대기열에 저장되었습니다. 서버 전송·전체 공개·자동 승인은 진행되지 않습니다.';
      go('complete');
    }catch(err){showToast(err.message);button.disabled=false;}
  };
  var dz=$('#dz'),input=$('#dz-input');
  dz.addEventListener('click',function(){input.click();});
  dz.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();input.click();}});
  input.addEventListener('change',function(){handleFile(input.files[0]);input.value='';});
  ['dragover','drop'].forEach(function(name){window.addEventListener(name,function(event){if(event.dataTransfer&&Array.from(event.dataTransfer.types).includes('Files'))event.preventDefault();});});
  dz.addEventListener('dragover',function(){dz.classList.add('over');});dz.addEventListener('dragleave',function(){dz.classList.remove('over');});
  dz.addEventListener('drop',function(event){event.preventDefault();dz.classList.remove('over');handleFile(event.dataTransfer.files[0]);});
  // Migrate only this project's obsolete worker, never another GitHub Pages app.
  if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){
    navigator.serviceWorker.getRegistrations().then(function(rs){
      var scope=new URL('./',document.baseURI).href;
      rs.forEach(function(r){var worker=r.active||r.waiting||r.installing;if(r.scope===scope&&worker&&new URL(worker.scriptURL).pathname.endsWith('/coi.js'))r.unregister();});
    }).catch(function(){});
  }
  refresh();restoreRoute();
})();
