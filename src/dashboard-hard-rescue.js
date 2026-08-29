"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");

const SCRIPT=`<script id="gn-hard-rescue-v1">(function(){
  function byId(id){return document.getElementById(id)}
  function setText(id,t){var e=byId(id);if(e)e.textContent=t}
  function setHtml(id,h){var e=byId(id);if(e)e.innerHTML=h}
  function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
  function timeoutFetch(url,ms){var c=new AbortController();var t=setTimeout(function(){c.abort()},ms||6000);return fetch(url,{signal:c.signal,cache:'no-store'}).then(function(r){clearTimeout(t);if(r.status===401){location.href='/login';throw new Error('LOGIN')}if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).catch(function(e){clearTimeout(t);throw e})}
  function top3Html(rows){rows=Array.isArray(rows)?rows.slice(0,3):[];if(!rows.length)return '<div class="empty">현재 실전 TOP3 없음</div>';return rows.map(function(r,i){var st=String(r.status||r.action||'대기');var px=r.krw_price!=null?Number(r.krw_price).toLocaleString()+'원':'가격 확인 중';var sc=Number.isFinite(Number(r.score))?Number(r.score).toFixed(1)+'점':'점수 확인 중';return '<article class="pick"><div class="pickRank">'+(i+1)+'</div><div class="pickMain"><div class="pickName">'+esc(String(r.market||'').replace('KRW-',''))+'</div><div class="pickPrice">현재 '+px+'</div><div class="pickMeta">'+esc(st)+' · '+sc+'</div></div></article>'}).join('')}
  function etfHtml(d){var rows=d&&Array.isArray(d.items)?d.items:[];if(!rows.length)return '<div class="empty">퇴직연금 ETF 데이터 없음</div>';return rows.map(function(x){var p=Number.isFinite(Number(x.price))?Number(x.price).toLocaleString()+'원':'가격 갱신 중';return '<div class="etfCard"><small>'+esc(x.code||'')+'</small><b>'+esc(x.name||'ETF')+'</b><strong>'+p+'</strong><span>'+esc(x.error||x.marketStatus||'')+'</span></div>'}).join('')}
  function portfolioHtml(p){var rows=[];if(Array.isArray(p))rows=p;else if(p&&Array.isArray(p.assets))rows=p.assets;else if(p&&Array.isArray(p.positions))rows=p.positions;else if(p&&Array.isArray(p.exchanges)){p.exchanges.forEach(function(x){(x.positions||[]).forEach(function(y){rows.push(Object.assign({exchange:x.exchange},y))})})}if(!rows.length)return '<div class="empty">연결된 보유 데이터 없음</div>';return rows.slice(0,10).map(function(r){return '<div class="row"><b>'+esc((r.exchange?String(r.exchange).toUpperCase()+' · ':'')+(r.symbol||r.asset||r.coin||r.market||''))+'</b><span>'+(r.price!=null?Number(r.price).toLocaleString():'가격 확인 중')+'</span><strong>보유</strong></div>'}).join('')}
  function decisionHtml(x){var m=x&&x.macro||{};var c=x&&Array.isArray(x.cryptoTop)?x.cryptoTop:[];var e=c.find(function(r){return String(r.status||'').toUpperCase()==='ENTRY'});if(e)return '<div class="heroLabel">지금 해야 할 일</div><div class="heroAction good">크립토 진입 후보 있음</div><div class="heroReason">'+esc(String(e.market||'').replace('KRW-',''))+' · 최신 검증 통과</div>';if(String(m.regime||'').toUpperCase()==='RISK_OFF')return '<div class="heroLabel">지금 해야 할 일</div><div class="heroAction bad">방어 우선</div><div class="heroReason">위험회피 레짐 · 신규 추격 금지</div>';return '<div class="heroLabel">지금 해야 할 일</div><div class="heroAction warn">관찰 유지</div><div class="heroReason">시장 데이터 수신 완료</div>'}
  async function hardLoad(){
    setText('updated','데이터 직접 조회 중…');
    var rs=await Promise.allSettled([timeoutFetch('/api/flow-map',6500),timeoutFetch('/api/etf/latest',6500),timeoutFetch('/api/portfolio',6500)]);
    if(rs[0].status==='fulfilled'){
      var x=rs[0].value||{};setHtml('decisionHero',decisionHtml(x));setHtml('top3',top3Html(x.cryptoTop||[]));setText('cryptoState',(x.cryptoTop||[]).length?'최신 후보 '+Math.min(3,(x.cryptoTop||[]).length)+'개':'현재 실전 ENTRY 없음');
      if(byId('leaders')&&!byId('leaders').innerHTML.trim())setHtml('leaders','<div class="empty">대표 선수 데이터 수신 완료</div>');
      if(byId('sectors')&&!byId('sectors').innerHTML.trim())setHtml('sectors','<div class="empty">섹터 데이터 수신 완료</div>');
    }else{
      setHtml('decisionHero','<div class="heroLabel">지금 해야 할 일</div><div class="heroAction bad">신규진입 중단</div><div class="heroReason">시장 판정 API 지연 · 자동 재조회</div>');setHtml('top3','<div class="empty">TOP3 데이터 지연 · 진입판정 보류</div>');setText('cryptoState','검증 지연');
    }
    setHtml('retirementEtf',rs[1].status==='fulfilled'?etfHtml(rs[1].value):'<div class="empty">ETF 시세 지연 · 자동 재조회</div>');
    setHtml('portfolio',rs[2].status==='fulfilled'?portfolioHtml(rs[2].value):'<div class="empty">보유자산 조회 지연 · 자동 재조회</div>');
    var failed=rs.filter(function(r){return r.status!=='fulfilled'}).length;setText('updated',(failed?'부분 지연 '+failed+'개':'정상')+' · '+new Date().toLocaleString()+' · 60초 자동');
  }
  window.hardLoad=hardLoad;
  setTimeout(hardLoad,50);
  setInterval(hardLoad,60000);
})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("<title>GN PIVOT</title>")||html.includes("gn-hard-rescue-v1"))return html;
  return html.replace("</body>",SCRIPT+"</body>");
}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
