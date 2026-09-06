/* Shared, explicitly device-local prototype data. Never an authorization boundary. */
(function (root) {
  'use strict';
  var KEY = 'pocabinder.prototype.v1';
  var catalog = [
    ['615','방탄소년단','정국','GOLDEN','앨범포카'],
    ['614','방탄소년단','V','Layover','앨범포카'],
    ['612','방탄소년단','RM','','앨범포카'],
    ['549','방탄소년단','지민','','팬미팅'],
    ['610','방탄소년단','진','','MD'],
    ['595','방탄소년단','슈가','','팬미팅'],
    ['591','스트레이 키즈','방찬','樂-STAR','앨범포카'],
    ['554','스트레이 키즈','현진','','앨범포카'],
    ['465','스트레이 키즈','필릭스','','앨범포카'],
    ['606','투모로우바이투게더','수빈','minisode 3','앨범포카'],
    ['599','투모로우바이투게더','연준','','앨범포카'],
    ['426','세븐틴','정한','','MD'],
    ['609','세븐틴','호시','','미확인'],
    ['283','aespa','카리나','','앨범포카'],
    ['267','aespa','윈터','','미확인'],
    ['190','트와이스','나연','','앨범포카']
  ].map(function (r) { return { id:r[0], artist:r[1], member:r[2], album:r[3], type:r[4], version:'', sample:true }; });
  var seeds = [
    {id:'sample-614',cardId:'614',confidence:97},
    {id:'sample-591',cardId:'591',confidence:95},
    {id:'sample-606',cardId:'606',confidence:94},
    {id:'sample-267',cardId:'267',confidence:65},
    {id:'sample-609',cardId:'609',confidence:78}
  ];
  function empty() { return {version:1,flags:{},submissions:[],reviews:{},history:[]}; }
  function read() {
    var raw;
    try { raw = root.localStorage.getItem(KEY); }
    catch (_) { throw new Error('이 브라우저에서 저장 공간에 접근할 수 없습니다. 저장을 허용한 뒤 다시 시도해 주세요.'); }
    if (!raw) return empty();
    try {
      var s = JSON.parse(raw);
      if (s.version !== 1 || !s.flags || !s.reviews || !Array.isArray(s.submissions) || !Array.isArray(s.history)) throw new Error();
      return s;
    } catch (_) { throw new Error('저장된 데이터를 읽지 못했습니다. 기존 데이터 보호를 위해 새 저장을 중단했습니다.'); }
  }
  function write(s) {
    try { root.localStorage.setItem(KEY, JSON.stringify(s)); }
    catch (_) { throw new Error('저장하지 못했습니다. 브라우저 저장 공간이나 개인정보 보호 설정을 확인해 주세요.'); }
    return s;
  }
  function all(s) { return catalog.concat(s.submissions); }
  function card(id,s) { return all(s).find(function (c) { return c.id === id; }); }
  function flags(id,s) { return s.flags[id] || {owned:false,wish:false}; }
  function toggle(id,kind) {
    var s=read();
    if (!card(id,s) || ['owned','wish'].indexOf(kind)<0) throw new Error('포카를 찾지 못했습니다.');
    s.flags[id] = Object.assign({},flags(id,s));
    s.flags[id][kind] = !s.flags[id][kind];
    write(s); return s.flags[id][kind];
  }
  function submit(record) {
    var s=read();
    if (s.submissions.some(function(c){return c.id===record.id;})) return record.id;
    if (!/^local-[a-zA-Z0-9-]+$/.test(record.id) || !record.artist.trim() || !record.member.trim()) throw new Error('아티스트와 멤버를 입력해 주세요.');
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(record.image)) throw new Error('저장할 사진을 다시 선택해 주세요.');
    s.submissions.unshift(Object.assign({},record,{sample:false,status:'pending',createdAt:new Date().toISOString()}));
    s.flags[record.id]={owned:true,wish:false};
    write(s); return record.id;
  }
  function queue(s) {
    return seeds.map(function(q){return Object.assign({},card(q.cardId,s),q,{sample:true});})
      .concat(s.submissions.map(function(c){return Object.assign({},c,{cardId:c.id});}));
  }
  function review(id,action,reason,target) {
    var s=read(), item=queue(s).find(function(q){return q.id===id;});
    if (!item) throw new Error('검수 대상을 찾지 못했습니다.');
    if (s.reviews[id]) throw new Error('이미 처리된 포카입니다. 목록을 새로 확인해 주세요.');
    if (['approved','rejected','merged'].indexOf(action)<0) throw new Error('처리 방법을 확인해 주세요.');
    if (action==='rejected' && !(reason||'').trim()) throw new Error('반려 사유를 입력해 주세요.');
    if (action==='merged' && (!catalog.some(function(c){return c.id===target;}) || target===item.cardId)) throw new Error('병합할 다른 기존 포카를 선택해 주세요.');
    var decision={status:action,reason:(reason||'').trim(),target:action==='merged'?target:null,at:new Date().toISOString()};
    s.reviews[id]=decision; s.history.unshift(Object.assign({id:id},decision));
    write(s); return decision;
  }
  function undo(id) {
    var s=read();
    if (!s.reviews[id]) throw new Error('이미 되돌렸거나 처리 이력이 없습니다.');
    delete s.reviews[id];
    s.history.unshift({id:id,status:'undone',at:new Date().toISOString()});
    write(s);
  }
  function search(query,type,s) {
    var q=(query||'').normalize('NFKC').toLocaleLowerCase().trim();
    var aliases={bts:'방탄소년단',skz:'스트레이 키즈',txt:'투모로우바이투게더',seventeen:'세븐틴',twice:'트와이스'};
    q=aliases[q]||q;
    return all(s).filter(function(c){
      return (!type || type==='전체' || c.type===type) &&
        [c.artist,c.member,c.album,c.type,c.id].join(' ').normalize('NFKC').toLocaleLowerCase().includes(q);
    });
  }
  function escape(value) { return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  root.PocaData={key:KEY,catalog:catalog,empty:empty,read:read,all:all,card:card,flags:flags,toggle:toggle,submit:submit,queue:queue,review:review,undo:undo,search:search,escape:escape};
})(typeof window!=='undefined'?window:globalThis);
