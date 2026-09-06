(function(){
  'use strict';
  var D=window.PocaData,e=D.escape,$=function(s){return document.querySelector(s);};
  var state=D.empty(),current=null,filter='pending',query='',toastTimer;
  var labels={pending:'검수 대기',approved:'승인',rejected:'반려',merged:'병합',undone:'처리 취소'};
  function refresh(){try{state=D.read();}catch(err){var s=$('#storage-status');s.hidden=false;s.textContent=err.message;}}
  window.showToast=function(msg){var t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.classList.remove('show');},4000);};
  function status(item){return state.reviews[item.id]?state.reviews[item.id].status:'pending';}
  function image(item){return item.image&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(item.image)?' style="background-image:url('+item.image+')"':'';}
  function picture(item){return '<div class="poca photo '+(item.sample?'ph-'+e(item.cardId):'')+'"'+image(item)+'><div class="nm">'+e(item.member)+'</div></div>';}
  function stats(){var q=D.queue(state);return '<div class="admin-stats">'+[['전체 체험 카드',q.length],['검수 대기',q.filter(function(c){return status(c)==='pending';}).length],['처리 완료',q.filter(function(c){return status(c)!=='pending';}).length],['직접 등록',state.submissions.length]].map(function(r){return '<div class="stat"><div class="k">'+r[0]+'</div><div class="v">'+r[1]+'</div></div>';}).join('')+'</div>';}
  function queue(){
    var q=D.queue(state).filter(function(c){return (filter==='all'||status(c)===filter)&&[c.artist,c.member,c.album,c.id].join(' ').toLowerCase().includes(query.toLowerCase());});
    q.sort(function(a,b){return (a.confidence==null?-1:a.confidence)-(b.confidence==null?-1:b.confidence);});
    $('#queue-summary').innerHTML=stats();
    $('#queue-count').textContent=q.length+'건 · 후보 점수가 낮은 카드부터 표시';
    $('#queue-cards').innerHTML=q.length?q.map(function(c){return '<article class="qcard"><div class="qrow">'+picture(c)+'<div class="qmeta"><div class="a">'+e(c.artist)+'</div><div class="m">'+e(c.member)+'</div><div class="al2">'+e(c.album||'앨범 미확인')+'</div><p>'+e(c.confidence==null?'후보 점수 없음':'후보 점수 '+c.confidence+'/100')+'</p><span class="status-pill">'+labels[status(c)]+'</span><p class="sub">'+(c.sample?'예시 데이터':'이 브라우저에서 직접 등록')+'</p></div></div><div class="qactions"><button class="btn btn-detail" data-detail="'+e(c.id)+'">'+(status(c)==='pending'?'상세 검수':'처리 내역')+'</button></div></article>';}).join(''):'<div class="empty-state">해당 조건의 카드가 없습니다.</div>';
  }
  window.go=function(name,id,replace){
    if(!['admin','detail','dashboard'].includes(name))name='admin';
    refresh();if(name==='detail'){current=id||current;if(!D.queue(state).some(function(c){return c.id===current;}))name='admin';}
    document.querySelectorAll('.screen').forEach(function(s){s.classList.toggle('active',s.id==='scr-'+name);});
    document.querySelectorAll('.proto-nav button').forEach(function(b){b.classList.toggle('on',b.dataset.nav===name);});
    var route=name+(name==='detail'?'/'+encodeURIComponent(current):'');if(location.hash!=='#'+route)history[replace?'replaceState':'pushState'](null,'','#'+route);
    if(name==='admin')queue();if(name==='detail')detail();if(name==='dashboard')dashboard();
    var h=$('.screen.active h1');h.tabIndex=-1;h.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});
  };
  window.openDetail=function(id){go('detail',id);};
  function detail(){
    var item=D.queue(state).find(function(c){return c.id===current;}),done=state.reviews[current];
    $('#scr-detail').innerHTML='<button class="btn btn-ghost" onclick="go(\'admin\')">← 검수 대기열</button><h1 style="margin-top:20px">'+e(item.member)+' · '+labels[status(item)]+'</h1><p class="sub">'+(item.sample?'예시 카드를 검수하는 체험입니다.':'현재 브라우저에 등록된 카드입니다.')+' 모든 처리는 이 브라우저에만 저장됩니다.</p><div class="detail-wrap"><div>'+picture(item)+'</div><div class="panel">'+[['아티스트',item.artist],['멤버',item.member],['앨범',item.album||'미확인'],['유형',item.type||'미확인'],['후보 점수',item.confidence==null?'없음':item.confidence+'/100'],['중복 여부','미확인 · 직접 비교 필요']].map(function(r){return '<div class="kv"><span class="k">'+r[0]+'</span><span class="v">'+e(r[1])+'</span></div>';}).join('')+(done?'<p class="sub">처리: '+labels[done.status]+'<br>사유: '+e(done.reason||'—')+(done.target?'<br>병합 대상: #'+e(done.target):'')+'<br>'+e(new Date(done.at).toLocaleString('ko-KR'))+'</p><button class="btn btn-ghost" data-undo="'+e(current)+'">처리 되돌리기</button>':'<div class="review-form"><label for="review-reason">검수 메모 · 반려 시 사유 필수</label><textarea id="review-reason" rows="3" maxlength="500" placeholder="예: 얼굴이 가려져 멤버 확인이 어렵습니다."></textarea><label for="merge-target">병합 대상 · 병합할 때만 선택</label><select id="merge-target"><option value="">기존 포카를 선택하세요</option>'+D.catalog.filter(function(c){return c.id!==item.cardId;}).map(function(c){return '<option value="'+c.id+'">#'+c.id+' · '+e(c.artist+' '+c.member+' '+(c.album||''))+'</option>';}).join('')+'</select><div class="decision"><button class="btn btn-approve-lg" data-review="approved">승인</button><button class="btn btn-merge-lg" data-review="merged">선택 카드와 병합</button><button class="btn btn-reject-lg" data-review="rejected">사유와 함께 반려</button></div><p class="sub">승인·반려·병합 상태와 사유를 기록합니다. 실제 공개 DB 변경이나 제보자 알림은 전송하지 않습니다.</p></div>')+'</div></div>';
  }
  function dashboard(){
    var items=D.queue(state);
    $('#scr-dashboard').innerHTML='<h1>운영 체험 대시보드</h1><p class="sub">현재 브라우저의 예시 카드와 직접 등록한 카드로 집계합니다.</p>'+stats()+'<div class="sec-title"><h3>검수 처리 이력</h3></div><div class="history-list">'+(state.history.length?state.history.slice(0,50).map(function(h){var c=items.find(function(c){return c.id===h.id;});return '<div class="history-item"><div><b>'+e(c?c.artist+' · '+c.member:h.id)+' · '+labels[h.status]+'</b><p>'+e(h.reason||'')+'</p><small>'+e(new Date(h.at).toLocaleString('ko-KR'))+'</small></div><button class="btn btn-ghost" data-detail="'+e(h.id)+'">상세 보기</button></div>';}).join(''):'<div class="empty-state">아직 처리한 카드가 없습니다.</div>')+'</div><div class="panel" style="margin-top:28px"><h3>기존 자료의 기준 수치</h3><p class="sub">기존 화면에 기재된 2026.07.30 스냅샷: 누적 제보 615건 · 검수 대기 612건 · 참여 유저 414명. 현재 운영 실적과 연결된 실시간 수치가 아닙니다. 이 체험 화면의 처리 결과는 해당 수치에 합산하지 않습니다.</p></div>';
  }
  document.addEventListener('click',function(event){
    var b=event.target.closest('[data-detail],[data-review],[data-undo]');if(!b)return;
    if(b.dataset.detail){openDetail(b.dataset.detail);return;}
    try{
      if(b.dataset.undo){D.undo(b.dataset.undo);refresh();detail();showToast('처리를 되돌리고 검수 대기열에 복원했습니다.');}
      if(b.dataset.review){D.review(current,b.dataset.review,$('#review-reason').value,$('#merge-target').value);go('admin');showToast(labels[b.dataset.review]+' 상태를 이 브라우저에 저장했습니다.');}
    }catch(err){showToast(err.message);}
  });
  $('#queue-filter').addEventListener('change',function(){filter=this.value;queue();});
  $('#queue-search').addEventListener('input',function(){query=this.value.trim();queue();});
  function restore(){var p=location.hash.slice(1).split('/'),id=null;try{id=p[1]?decodeURIComponent(p[1]):null;}catch(_){}go(p[0]||'admin',id,true);}
  window.addEventListener('popstate',restore);
  window.addEventListener('storage',function(ev){if(ev.key===D.key){refresh();var active=$('.screen.active').id;if(active==='scr-admin')queue();if(active==='scr-dashboard')dashboard();if(active==='scr-detail')detail();}});
  restore();
})();
