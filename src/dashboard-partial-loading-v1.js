"use strict";

// Final fail-open UI loader for GN PIVOT.
// One slow/failed provider must never keep unrelated dashboard sections in a global loading state.
const expressPath=require.resolve("express");
const previousExpress=require("express");
const crypto=require("node:crypto");
const {createClient}=require("@supabase/supabase-js");

const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const USER=process.env.DASHBOARD_USER||"gn";
const PASS=process.env.DASHBOARD_PASSWORD||"";
const COOKIE_NAME="gn_auth";
function authToken(){return crypto.createHmac("sha256",PASS).update(USER).digest("hex");}
function getCookie(req,name){const raw=req.headers.cookie||"";for(const part of raw.split(";")){const i=part.indexOf("=");if(i<0)continue;if(part.slice(0,i).trim()===name)return decodeURIComponent(part.slice(i+1).trim());}return "";}
function isAuthed(req){return !!PASS&&getCookie(req,COOKIE_NAME)===authToken();}

async function providerStatus(req,res){
  if(!isAuthed(req))return res.status(401).json({error:"Authentication required"});
  try{
    const {data,error}=await db.from("gn_data_provider_status")
      .select("provider,provider_type,status,last_success_at,last_attempt_at,data_quality,error,details")
      .in("provider",["nansen","coinmetrics_community","coinbase_premium","glassnode","onchain_composite"]);
    if(error)throw error;
    res.set("Cache-Control","no-store");
    res.json({ts:new Date().toISOString(),items:data||[]});
  }catch(e){res.status(500).json({error:String(e?.message||e)});}
}

const SCRIPT=`<style id="gn-partial-loading-style-v1">
.gnProviderWarn{color:#ffd166!important}.gnProviderBad{color:#ff8b8b!important}.gnSectionWait{color:#9aa7b4}.gnSectionError{color:#ff9aa3}
</style><script id="gn-partial-loading-v1">(function(){
  var generation=0,flowData=null,stockData={items:[]},providerData=null;
  var sectionState={flow:'idle',stocks:'idle',etf:'idle',portfolio:'idle',providers:'idle'};
  var sectionError={};
  function byId(id){return document.getElementById(id)}
  function setText(id,text){var e=byId(id);if(e)e.textContent=text}
  function setHtml(id,html){var e=byId(id);if(e)e.innerHTML=html}
  function esc(v){return String(v==null?'':v).replace(/[&<>\\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;',"'":'&#39;'}[c]})}
  function statusLine(){
    var keys=['flow','stocks','etf','portfolio'];
    var ok=keys.filter(function(k){return sectionState[k]==='ok'}).length;
    var loading=keys.filter(function(k){return sectionState[k]==='loading'}).length;
    var failed=keys.filter(function(k){return sectionState[k]==='error'}).length;
    if(loading)return '부분 갱신 중 · 완료 '+ok+'/4 · '+new Date().toLocaleTimeString();
    if(failed)return '부분 지연 '+failed+'개 · 정상 '+ok+'/4 · '+new Date().toLocaleTimeString()+' · 60초 자동';
    return '정상 · '+new Date().toLocaleString()+' · 60초 자동';
  }
  function updateHeader(){setText('updated',statusLine())}
  function request(key,url,ms,token){
    sectionState[key]='loading';delete sectionError[key];updateHeader();
    var c=new AbortController(),t=setTimeout(function(){c.abort()},ms||5000);
    return window.fetch(url+(url.indexOf('?')>=0?'&':'?')+'t='+Date.now(),{signal:c.signal,cache:'no-store'})
      .then(function(r){clearTimeout(t);if(r.status===401){location.href='/login';throw new Error('LOGIN')}if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
      .then(function(data){if(token!==generation)return null;sectionState[key]='ok';updateHeader();return data})
      .catch(function(e){clearTimeout(t);if(token!==generation)return null;sectionState[key]='error';sectionError[key]=(e&&e.name==='AbortError')?'응답시간 초과':String(e&&e.message||e);updateHeader();return null});
  }
  function renderFlow(x){
    if(!x)return;
    flowData=x;
    try{setHtml('decisionHero',typeof mainDecision==='function'?mainDecision(x):'<div class="heroLabel">지금 해야 할 일</div><div class="heroAction warn">관찰</div><div class="heroReason">시장 데이터 수신</div>')}catch(e){}
    try{setHtml('leaders',typeof leaderCards==='function'?leaderCards(x):'<div class="empty">대표 자산 데이터 수신</div>')}catch(e){}
    try{setHtml('top3',typeof top3Cards==='function'?top3Cards(x.cryptoTop||[]):'<div class="empty">TOP3 데이터 수신</div>')}catch(e){}
    try{
      var entries=(x.cryptoTop||[]).filter(function(r){return String(r.status||'').toUpperCase()==='ENTRY'}).length;
      setText('cryptoState',entries?'실전 ENTRY '+entries:'현재 실전 ENTRY 없음');
    }catch(e){}
    try{setHtml('sectors',typeof sectorCards==='function'?sectorCards(x,stockData):'<div class="empty">섹터 데이터 수신</div>')}catch(e){}
    try{setHtml('diag',typeof diagnostics==='function'?diagnostics(x):'')}catch(e){}
    applyProviderWarning();
  }
  function renderStocks(q){stockData=q&&Array.isArray(q.items)?q:{items:[]};if(flowData){try{setHtml('sectors',sectorCards(flowData,stockData))}catch(e){}}}
  function renderEtf(e){try{setHtml('retirementEtf',typeof etfCards==='function'?etfCards(e):'<div class="empty">ETF 데이터 수신</div>')}catch(err){setHtml('retirementEtf','<div class="empty">ETF 표시 오류</div>')}}
  function renderPortfolio(p){
    try{
      if(typeof portfolioHtml==='function')setHtml('portfolio',portfolioHtml(p));
      else if(typeof portfolioRows==='function')setHtml('portfolio',portfolioRows(p));
      else setHtml('portfolio','<div class="empty">보유자산 데이터 수신</div>');
    }catch(e){setHtml('portfolio','<div class="empty">보유자산 표시 오류</div>')}
  }
  function providerMap(){var out={};((providerData&&providerData.items)||[]).forEach(function(x){out[String(x.provider||'')]=x});return out}
  function applyProviderWarning(){
    if(!providerData)return;
    var p=providerMap(),n=p.nansen||{},c=p.onchain_composite||{};
    var nBad=String(n.status||'').toLowerCase()!=='success';
    var entryBlocked=c&&c.details&&c.details.usable_for_entry===false;
    var credit=/insufficient credits/i.test(String(n.error||''));
    var pill=byId('cryptoState');
    if(pill&&(nBad||entryBlocked)){
      var base=(pill.textContent||'').replace(/ · 온체인 제한.*$/,'');
      pill.textContent=base+' · 온체인 제한'+(credit?'(Nansen 크레딧)':'');
      pill.classList.add('gnProviderWarn');
    }
    var d=byId('diag');
    if(d){
      var old=d.querySelector('[data-gn-provider-warning="1"]');if(old)old.remove();
      if(nBad||entryBlocked){
        var row=document.createElement('div');row.setAttribute('data-gn-provider-warning','1');row.className=credit?'gnProviderBad':'gnProviderWarn';
        row.textContent=credit?'온체인: Nansen 크레딧 부족 · 다른 데이터는 계속 표시 · 크립토 ENTRY만 제한':'온체인 검증 제한 · 다른 섹션은 정상 표시';d.appendChild(row);
      }
    }
  }
  function failFlow(msg){
    setHtml('decisionHero','<div class="heroLabel">지금 해야 할 일</div><div class="heroAction warn">시장 데이터 지연</div><div class="heroReason">다른 섹션은 계속 갱신 · 신규 진입 판정만 보류</div>');
    setHtml('leaders','<div class="empty">대표 선수 데이터 지연 · 자동 재조회</div>');
    setHtml('top3','<div class="empty">TOP3 원본 데이터 지연 · 진입 판정 보류</div>');
    setText('cryptoState','검증 지연');
    setHtml('sectors','<div class="empty">섹터 원본 데이터 지연</div>');
    setHtml('diag','<div class="gnSectionError">flow-map · '+esc(msg||'조회 지연')+'</div>');
  }
  function loadPartial(){
    var token=++generation;flowData=null;stockData={items:[]};
    ['flow','stocks','etf','portfolio','providers'].forEach(function(k){sectionState[k]='idle';delete sectionError[k]});
    updateHeader();
    setTimeout(function(){if(token!==generation)return;if(sectionState.flow==='loading'&&!flowData){setHtml('leaders','<div class="empty gnSectionWait">대표 선수 먼저 불러오는 중 · 다른 섹션과 독립 갱신</div>')}},900);
    request('flow','/api/flow-map',5000,token).then(function(x){if(token!==generation)return;if(x)renderFlow(x);else failFlow(sectionError.flow)});
    request('stocks','/api/stock-quotes',4500,token).then(function(q){if(token!==generation)return;if(q)renderStocks(q);else if(flowData){try{setHtml('sectors',sectorCards(flowData,{items:[]}))}catch(e){}}});
    request('etf','/api/etf/latest',4500,token).then(function(e){if(token!==generation)return;if(e)renderEtf(e);else setHtml('retirementEtf','<div class="empty">ETF 시세 지연 · 다른 섹션은 정상 갱신 · 자동 재조회</div>')});
    request('portfolio','/api/portfolio',4500,token).then(function(p){if(token!==generation)return;if(p)renderPortfolio(p);else setHtml('portfolio','<div class="empty">보유자산 조회 지연 · 다른 섹션은 정상 갱신 · 자동 재조회</div>')});
    request('providers','/api/provider-status',3500,token).then(function(p){if(token!==generation)return;if(p){providerData=p;applyProviderWarning()}});
  }
  function bindRefresh(){
    var header=document.querySelector('header');if(!header)return;
    var old=byId('gnManualRefresh')||Array.from(header.querySelectorAll('button')).find(function(x){return /새로고침|갱신/.test(x.textContent||'')});if(!old)return;
    var b=old.cloneNode(true);b.id='gnManualRefresh';b.type='button';b.textContent='새로고침';b.dataset.gnBound='1';old.parentNode.replaceChild(b,old);
    b.addEventListener('click',function(ev){ev.preventDefault();ev.stopImmediatePropagation();loadPartial()},{passive:false});
    b.addEventListener('touchend',function(ev){ev.preventDefault();ev.stopImmediatePropagation();loadPartial()},{passive:false});
  }
  window.loadAll=loadPartial;window.gnPartialLoad=loadPartial;
  bindRefresh();setTimeout(bindRefresh,500);setTimeout(bindRefresh,1800);
  loadPartial();setInterval(loadPartial,60000);setInterval(applyProviderWarning,4000);
})();</script>`;

function stripLegacyGlobalLoaders(html){
  if(typeof html!=="string")return html;
  // The old global loader waited for every endpoint. Remove only its auto-start/interval,
  // and remove the old resilience/hard-rescue runners so they cannot race the independent loader.
  html=html.replace(/loadAll\(\);setInterval\(loadAll,60000\);<\/script>/,'</script>');
  html=html.replace(/<script id="gn-dashboard-resilience-v1">[\s\S]*?<\/script>/,'');
  html=html.replace(/<script id="gn-hard-rescue-v2">[\s\S]*?<\/script>/,'');
  return html;
}
function patchHtml(html){
  if(typeof html!=="string"||!html.includes("<title>GN PIVOT</title>")||html.includes("gn-partial-loading-v1"))return html;
  html=stripLegacyGlobalLoaders(html);
  return html.replace("</body>",SCRIPT+"</body>");
}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.get("/api/provider-status",providerStatus);
  app.use((req,res,next)=>{
    const send=res.send.bind(res);
    res.send=function(body){return send(patchHtml(body));};
    next();
  });
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
