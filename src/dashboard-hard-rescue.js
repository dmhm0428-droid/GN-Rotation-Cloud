"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");

const SCRIPT=`<script id="gn-hard-rescue-v2">(function(){
  function byId(id){return document.getElementById(id)}
  function setText(id,t){var e=byId(id);if(e)e.textContent=t}
  function setHtml(id,h){var e=byId(id);if(e)e.innerHTML=h}
  function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
  function timeoutFetch(url,ms){var c=new AbortController();var t=setTimeout(function(){c.abort()},ms||6000);return fetch(url,{signal:c.signal,cache:'no-store'}).then(function(r){clearTimeout(t);if(r.status===401){location.href='/login';throw new Error('LOGIN')}if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).catch(function(e){clearTimeout(t);throw e})}
  function etfHtml(d){var rows=d&&Array.isArray(d.items)?d.items:[];if(!rows.length)return '<div class="empty">퇴직연금 ETF 데이터 없음</div>';return rows.map(function(x){var p=Number.isFinite(Number(x.price))?Number(x.price).toLocaleString()+'원':'가격 갱신 중';return '<div class="etfCard"><small>'+esc(x.code||'')+'</small><b>'+esc(x.name||'ETF')+'</b><strong>'+p+'</strong><span>'+esc(x.error||x.marketStatus||'')+'</span></div>'}).join('')}
  function portfolioHtml(p){var rows=[];if(Array.isArray(p))rows=p;else if(p&&Array.isArray(p.assets))rows=p.assets;else if(p&&Array.isArray(p.positions))rows=p.positions;else if(p&&Array.isArray(p.exchanges)){p.exchanges.forEach(function(x){(x.positions||[]).forEach(function(y){rows.push(Object.assign({exchange:x.exchange},y))})})}if(!rows.length)return '<div class="empty">연결된 보유 데이터 없음</div>';return rows.slice(0,10).map(function(r){return '<div class="row"><b>'+esc((r.exchange?String(r.exchange).toUpperCase()+' · ':'')+(r.symbol||r.asset||r.coin||r.market||''))+'</b><span>'+(r.price!=null?Number(r.price).toLocaleString():'가격 확인 중')+'</span><strong>보유</strong></div>'}).join('')}
  async function hardLoad(){
    var live=!!byId('gn-live-summary-v2');
    if(!live)setText('updated','데이터 직접 조회 중…');
    var rs=await Promise.allSettled([timeoutFetch('/api/etf/latest',6500),timeoutFetch('/api/portfolio',6500)]);
    setHtml('retirementEtf',rs[0].status==='fulfilled'?etfHtml(rs[0].value):'<div class="empty">ETF 시세 지연 · 자동 재조회</div>');
    setHtml('portfolio',rs[1].status==='fulfilled'?portfolioHtml(rs[1].value):'<div class="empty">보유자산 조회 지연 · 자동 재조회</div>');
    if(!live){var failed=rs.filter(function(r){return r.status!=='fulfilled'}).length;setText('updated',(failed?'부분 지연 '+failed+'개':'정상')+' · '+new Date().toLocaleString()+' · 60초 자동');}
  }
  window.hardLoad=hardLoad;
  setTimeout(hardLoad,50);
  setInterval(hardLoad,60000);
})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("<title>GN PIVOT</title>")||html.includes("gn-hard-rescue-v2"))return html;
  return html.replace("</body>",SCRIPT+"</body>");
}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
