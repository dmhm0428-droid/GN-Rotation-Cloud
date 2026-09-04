"use strict";

// Final operational layer. It is intentionally last in the HTML response chain and does not
// depend on any earlier dashboard renderer. A broken optional UI patch must never leave GN PIVOT
// stuck on "loading" forever.
const expressPath=require.resolve("express");
const previousExpress=require("express");

const INJECT=`<style id="gn-operational-status-color-v2">.gnProviderBad,.gnSectionError,[data-gn-provider-warning="1"]{color:#ffd166!important}.gnStaleNote{color:#ffd166!important}</style>
<script id="gn-final-rescue-v1">(function(){
'use strict';
var $=function(id){return document.getElementById(id)};
var esc=function(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})};
var num=function(v){var n=Number(v);return Number.isFinite(n)?n:null};
var nf=function(v){var n=num(v);return n==null?'--':n.toLocaleString()};
function get(url,ms){var c=new AbortController(),t=setTimeout(function(){c.abort()},ms||6500);return fetch(url+(url.indexOf('?')>=0?'&':'?')+'rescue='+Date.now(),{cache:'no-store',signal:c.signal}).then(function(r){clearTimeout(t);if(r.status===401){location.href='/login';throw Error('LOGIN')}if(!r.ok)throw Error('HTTP '+r.status);return r.json()}).catch(function(e){clearTimeout(t);throw e})}
function set(id,html){var e=$(id);if(e)e.innerHTML=html}
function text(id,s){var e=$(id);if(e)e.textContent=s}
function leaders(d){var reps=d&&d.reps||[],assets=d&&d.assets||[],classes=[['CRYPTO','크립토'],['BOND','채권'],['GOLD','금'],['COMMODITY','원자재'],['CASH','현금']];var out=['<div class="leader"><div class="leaderTop"><span>미국주식 · AI 소프트웨어</span><b class="warn">관찰</b></div><div class="leaderSymbol">MNDY · NOW · CRWD · DDOG</div><div class="leaderMeta">독립 복구 렌더러</div></div>'];classes.forEach(function(x){var r=reps.filter(function(z){return z.asset_class===x[0]}).sort(function(a,b){return Number(b.total_score||0)-Number(a.total_score||0)})[0]||{},a=assets.find(function(z){return z.asset_class===x[0]})||{};out.push('<div class="leader"><div class="leaderTop"><span>'+x[1]+'</span><b class="neutral">'+esc(r.action||a.action||'관찰')+'</b></div><div class="leaderSymbol">'+esc(r.symbol||'--')+'</div><div class="leaderMeta">점수 '+esc(r.total_score!=null?Number(r.total_score).toFixed(1):(a.flow_score!=null?Number(a.flow_score).toFixed(1):'--'))+(r.price!=null?' · '+nf(r.price):'')+'</div></div>')});return out.join('')}
function top3(d){var rows=(d&&d.cryptoRadar||[]).slice(0,3);if(!rows.length)return '<div class="empty">현재 유효 TOP3 없음 · 자동 재조회</div>';return rows.map(function(r,i){return '<article class="pick"><div class="pickRank">'+(i+1)+'</div><div class="pickMain"><div class="pickName">'+esc(String(r.market||'').replace('KRW-',''))+' <span class="warn">'+esc(r.status||'WATCH')+'</span></div><div class="pickPrice">현재 '+nf(r.krw_price)+'원</div><div class="pickMeta">점수 '+esc(r.score!=null?Number(r.score).toFixed(1):'--')+'</div></div></article>'}).join('')}
function sector(d){var rows=d&&d.aiSoftware||[];return rows.length?rows.map(function(r){return '<div class="sector"><div><small>AI SOFTWARE</small><b>'+esc(r.symbol)+' · '+esc(r.name)+'</b><small>'+esc(r.basis||'')+'</small></div><div><strong>'+(r.price!=null?'$'+nf(r.price):'가격 지연')+'</strong></div></div>'}).join(''):'<div class="empty">섹터 데이터 재조회 중</div>'}
function etf(d){var rows=d&&d.items||[];return rows.length?rows.map(function(x){return '<div class="etfCard"><small>'+esc(x.code||'')+'</small><b>'+esc(x.name||'ETF')+'</b><strong>'+(x.price!=null?nf(x.price)+'원':'가격 지연')+'</strong></div>'}).join(''):'<div class="empty">ETF 데이터 없음 · 다음 갱신 재시도</div>'}
function portfolio(p){var rows=[];if(Array.isArray(p))rows=p;else if(Array.isArray(p&&p.assets))rows=p.assets;else if(Array.isArray(p&&p.positions))rows=p.positions;else if(Array.isArray(p&&p.exchanges))p.exchanges.forEach(function(x){(x.positions||[]).forEach(function(y){rows.push(Object.assign({exchange:x.exchange},y))})});return rows.length?rows.slice(0,10).map(function(r){return '<div class="row"><b>'+esc((r.exchange?String(r.exchange).toUpperCase()+' · ':'')+(r.symbol||r.asset||r.coin||r.market||''))+'</b><span>'+(r.price!=null?nf(r.price):'가격 지연')+'</span><strong>보유</strong></div>'}).join(''):'<div class="empty">연결된 보유 데이터 없음</div>'}
async function run(){var started=Date.now();var rs=await Promise.allSettled([get('/api/live-summary',6500),get('/api/etf/latest',6500),get('/api/portfolio',6500),get('/api/market/latest',6500)]);var live=rs[0].status==='fulfilled'?rs[0].value:null,ev=rs[1].status==='fulfilled'?rs[1].value:null,pv=rs[2].status==='fulfilled'?rs[2].value:null,mv=rs[3].status==='fulfilled'?rs[3].value:null;if(live){set('leaders',leaders(live));set('top3',top3(live));set('sectors',sector(live));text('cryptoState','탐지 TOP3 '+((live.cryptoRadar||[]).slice(0,3).length)+'개 · '+(live.consensus&&live.consensus.all_five_ok?'5AI VERIFIED':'ENTRY 승인 보류'));var dec=$('decision'),reason=$('decisionReason');if(dec){dec.textContent='관찰';dec.className='heroAction warn'}if(reason)reason.textContent='시장 데이터 수신 · 독립 복구 렌더러 정상'}else{set('leaders','<div class="empty">대표 자산 API 지연 · 다른 영역 독립 조회</div>');set('top3','<div class="empty">TOP3 API 지연 · ENTRY 보류</div>');text('cryptoState','데이터 지연')}
if(ev)set('retirementEtf',etf(ev));else set('retirementEtf','<div class="empty">ETF API 지연 · 자동 재조회</div>');if(pv)set('portfolio',portfolio(pv));else set('portfolio','<div class="empty">보유자산 API 지연 · 자동 재조회</div>');var ok=rs.filter(function(x){return x.status==='fulfilled'}).length;var score=mv&&mv.market_score!=null?' · 발자국 '+Number(mv.market_score).toFixed(1):'';text('updated',(ok===4?'정상':'부분 정상 '+ok+'/4')+score+' · '+new Date().toLocaleTimeString()+' · 15초 자동');}
setTimeout(run,900);setInterval(run,15000);window.gnFinalRescue=run;
})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("gn-final-rescue-v1"))return html;
  return html.replace("</body>",INJECT+"</body>");
}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
