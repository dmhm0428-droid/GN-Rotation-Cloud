"use strict";
const expressPath=require.resolve("express");
const originalExpress=require("express");
const INJECT=`<script id="gn-dashboard-resilience-v1">(function(){
  const nativeFetch=window.fetch.bind(window);
  window.fetch=function(input,init){
    init=init||{};
    if(init.signal)return nativeFetch(input,init);
    const c=new AbortController();
    const t=setTimeout(function(){c.abort();},8000);
    return nativeFetch(input,Object.assign({},init,{signal:c.signal})).finally(function(){clearTimeout(t);});
  };
  async function getJson(url){
    try{
      const r=await window.fetch(url);
      if(r.status===401){location.href='/login';throw new Error('로그인이 필요합니다');}
      if(!r.ok)throw new Error('HTTP '+r.status);
      return {ok:true,data:await r.json()};
    }catch(e){return {ok:false,error:(e&&e.name==='AbortError')?'8초 응답시간 초과':String(e&&e.message||e)};}
  }
  function setHtml(id,html){const el=document.getElementById(id);if(el)el.innerHTML=html;}
  function setText(id,text){const el=document.getElementById(id);if(el)el.textContent=text;}
  function portfolioHtml(p){
    if(typeof portfolioRows==='function' && (Array.isArray(p)||p&&((p.assets&&p.assets.length)||(p.positions&&p.positions.length)))) return portfolioRows(p);
    const ex=Array.isArray(p&&p.exchanges)?p.exchanges:[];
    const rows=[];
    ex.forEach(function(x){(x.positions||[]).forEach(function(pos){rows.push(Object.assign({exchange:x.exchange},pos));});});
    if(!rows.length){
      const errors=ex.filter(function(x){return x&&x.error;}).map(function(x){return x.exchange+' '+x.error;});
      return '<div class="empty">'+(errors.length?'보유자산 연결 오류 · '+errors.join(' / '):'연결된 보유 데이터 없음')+'</div>';
    }
    return rows.slice(0,12).map(function(r){return '<div class="row"><b>'+String(r.exchange||'').toUpperCase()+' · '+String(r.asset||'')+'</b><span>'+(r.price==null?'가격 확인 중':nf(r.price))+'</span><strong class="neutral">보유</strong></div>';}).join('');
  }
  async function resilientLoadAll(){
    setText('updated','데이터 갱신 중…');
    const results=await Promise.all([getJson('/api/flow-map'),getJson('/api/portfolio'),getJson('/api/stock-quotes'),getJson('/api/etf/latest')]);
    const x=results[0],p=results[1],q=results[2],e=results[3];
    if(x.ok){
      setHtml('decisionHero',mainDecision(x.data));
      setHtml('leaders',leaderCards(x.data));
      setHtml('top3',top3Cards(x.data.cryptoTop||[]));
      const entries=(x.data.cryptoTop||[]).filter(function(r){return String(r.status||'').toUpperCase()==='ENTRY';}).length;
      setText('cryptoState',entries?'실전 ENTRY '+entries:'현재 실전 ENTRY 없음');
      setHtml('sectors',sectorCards(x.data,q.ok?q.data:{items:[]}));
      setHtml('diag',diagnostics(x.data));
    }else{
      setHtml('decisionHero','<div class="heroLabel">지금 해야 할 일</div><div class="heroAction bad">신규진입 중단</div><div class="heroReason">시장 판정 데이터 지연 · '+x.error+'</div>');
      setHtml('leaders','<div class="empty">대표 선수 데이터 지연</div>');
      setHtml('top3','<div class="empty">TOP3 검증 데이터 지연 · 진입 판정 보류</div>');
      setText('cryptoState','검증 지연');
      setHtml('sectors','<div class="empty">섹터 데이터 지연</div>');
      setHtml('diag','<div>flow-map 오류 · '+x.error+'</div>');
    }
    setHtml('retirementEtf',e.ok?etfCards(e.data):'<div class="empty">퇴직연금 ETF 시세 지연 · '+e.error+'</div>');
    setHtml('portfolio',p.ok?portfolioHtml(p.data):'<div class="empty">보유자산 조회 지연 · '+p.error+'</div>');
    const failed=results.filter(function(r){return !r.ok;}).length;
    setText('updated',(failed?'부분 지연 '+failed+'개 · ':'정상 · ')+'갱신 '+new Date().toLocaleString()+' · 60초 자동');
  }
  window.loadAll=resilientLoadAll;
  setTimeout(function(){
    const u=document.getElementById('updated');
    if(u&&/불러오는|확인 중|계산 중|갱신 중/.test(u.textContent||'')){
      u.textContent='응답 지연 감지 · 재조회 중';
      resilientLoadAll();
    }
  },10000);
  resilientLoadAll();
})();</script>`;
function patchHtml(html){
  if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("gn-dashboard-resilience-v1"))return html;
  return html.replace("</body>",INJECT+"</body>");
}
function wrappedExpress(...args){
  const app=originalExpress(...args);
  app.use((req,res,next)=>{
    const send=res.send.bind(res);
    res.send=function(body){return send(patchHtml(body));};
    next();
  });
  return app;
}
Object.assign(wrappedExpress,originalExpress);
require.cache[expressPath].exports=wrappedExpress;
