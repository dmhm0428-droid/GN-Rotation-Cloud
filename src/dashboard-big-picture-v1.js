"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");
const {createClient}=require("@supabase/supabase-js");
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

const num=v=>Number.isFinite(Number(v))?Number(v):null;
let mvrvCache={at:0,data:null};
async function fetchJson(url,timeout=8000){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);
  try{
    const r=await fetch(url,{signal:c.signal,headers:{accept:"application/json","user-agent":"GN-PIVOT-MVRV/2.0"}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }finally{clearTimeout(timer);}
}
function freshEnough(asOf,maxDays=3){
  if(!asOf)return false;
  const t=new Date(asOf).getTime();
  return Number.isFinite(t)&&Date.now()-t<=maxDays*86400000;
}
function rowFrom(payload){
  if(Array.isArray(payload))return payload.at(-1)||{};
  if(Array.isArray(payload?.data))return payload.data.at(-1)||{};
  return payload?.data&&typeof payload.data==="object"?payload.data:(payload||{});
}
async function btcMvrv(){
  if(mvrvCache.data&&Date.now()-mvrvCache.at<4*3600000)return mvrvCache.data;
  const errors=[];
  try{
    const j=await fetchJson("https://bitcoin-data.com/v1/mvrv/last"),row=rowFrom(j),v=num(row.mvrv??row.value),asOf=row.d||row.date||row.time||row.timestamp||null;
    if(v==null)throw new Error("value unavailable");
    if(!freshEnough(asOf,3))throw new Error(`stale ${asOf||"unknown"}`);
    const data={value:v,asOf,source:"BGeometrics MVRV",fresh:true,error:null};mvrvCache={at:Date.now(),data};return data;
  }catch(e){errors.push(`BGeometrics:${String(e?.message||e)}`);}
  try{
    const url="https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&frequency=1d&page_size=2&paging_from=end";
    const j=await fetchJson(url),rows=(j?.data||[]).slice().sort((a,b)=>String(a.time).localeCompare(String(b.time))),row=rows.at(-1)||{},v=num(row.CapMVRVCur),asOf=row.time||null;
    if(v==null)throw new Error("value unavailable");
    if(!freshEnough(asOf,3))throw new Error(`stale ${asOf||"unknown"}`);
    const data={value:v,asOf,source:"Coin Metrics CapMVRVCur",fresh:true,error:null};mvrvCache={at:Date.now(),data};return data;
  }catch(e){errors.push(`CoinMetrics:${String(e?.message||e)}`);}
  const data={value:null,asOf:null,source:"BGeometrics + Coin Metrics",fresh:false,error:errors.join(" | ")};mvrvCache={at:Date.now(),data};return data;
}
function footprintState(score){
  if(score==null)return "데이터대기";
  if(score>=65)return "위험선호";
  if(score>=50)return "중립우위";
  if(score>=40)return "주의";
  return "위험회피";
}
function mvrvState(v,footprint,fresh){
  if(v==null||fresh!==true)return {signal:"DATA_WAIT",label:"MVRV 데이터대기",guide:"최신값 검증 전 신호 없음"};
  if(v<1){
    const risk=footprint!=null&&footprint<50;
    return {signal:"BUY_SIGNAL",label:"BTC 매수신호",guide:risk?"MVRV<1 가치구간 · 큰그림 약세라 분할/대기 우선":"MVRV<1 가치구간 · 큰그림 확인 후 매수우위"};
  }
  if(v<1.2)return {signal:"VALUE_WATCH",label:"BTC 가치관찰",guide:"MVRV 1~1.2 · 저평가 접근 구간"};
  return {signal:"WAIT",label:"BTC 대기",guide:"MVRV 1 이상 · 단독 가치매수 신호 없음"};
}
async function bigPicture(req,res){
  try{
    const [marketR,macroR,overlayR,mvrv]=await Promise.all([
      db.from("gn_market_snapshots").select("ts,market_score,action,regime,quality,spot_breadth100,spot_breadth50,funding_positive,funding_median,funding_hot,btc_taker_ratio,eth_taker_ratio,reasons").order("ts",{ascending:false}).limit(1).maybeSingle(),
      db.from("gn_macro_regime").select("ts,regime,liquidity_score,rates_score,usd_fx_score,commodities_score,volatility_score,policy_score,macro_score,data_quality,components,source_errors").order("ts",{ascending:false}).limit(1).maybeSingle(),
      db.from("gn_overlays").select("events,updated_at,note").eq("id",1).maybeSingle(),
      btcMvrv()
    ]);
    const market=marketR.data||null,macro=macroR.data||null,overlay=overlayR.data||null;
    const footprint=num(market?.market_score),mv=mvrvState(mvrv.value,footprint,mvrv.fresh);
    res.set("Cache-Control","no-store");
    res.json({ts:new Date().toISOString(),footprint,footprintState:footprintState(footprint),market,macro,mvrv:{...mvrv,...mv},events:overlay?.events?.GLOBAL||null,eventUpdatedAt:overlay?.updated_at||null,mode:"BIG_PICTURE_FIRST"});
  }catch(e){res.status(500).json({error:String(e?.message||e)});}
}
const SCRIPT=`<script id="gn-big-picture-v1">(function(){
function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
function f(v){return Number.isFinite(Number(v))?Number(v).toFixed(1):'--'}
function eventText(e){if(!e)return '이벤트 감시 데이터대기';var a=[];if(e.G20)a.push('G20 '+(e.G20.status||'감시'));if(e.EMPLOYMENT)a.push('고용 '+(e.EMPLOYMENT.status||'감시'));if(e.PPI)a.push('PPI '+(e.PPI.status||'감시'));if(e.CPI)a.push('CPI '+(e.CPI.status||'감시'));if(e.SEPTEMBER_DATA)a.push('9월 실물지표 '+(e.SEPTEMBER_DATA.status||'감시'));return a.join(' · ')||'이벤트 감시 데이터대기'}
function mount(){var old=document.getElementById('gnBigPicture');if(old)return old;var host=document.getElementById('top3');var sec=host&&host.closest?host.closest('section'):null;var box=document.createElement('section');box.id='gnBigPicture';box.style.cssText='margin:14px 0;padding:14px;border:1px solid rgba(128,128,128,.25);border-radius:14px;background:rgba(127,127,127,.06)';box.innerHTML='<div style="font-weight:800;margin-bottom:8px">큰그림 감시 · 최종 발자국</div><div id="gnBigPictureBody">불러오는 중</div>';if(sec&&sec.parentNode)sec.parentNode.insertBefore(box,sec);else{var main=document.querySelector('main')||document.body;main.insertBefore(box,main.firstChild)}return box}
async function load(){mount();var body=document.getElementById('gnBigPictureBody');try{var r=await fetch('/api/big-picture?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);var d=await r.json(),m=d.mvrv||{},macro=d.macro||{},market=d.market||{};var strong=m.signal==='BUY_SIGNAL';body.innerHTML='<div style="font-size:20px;font-weight:800">발자국 '+f(d.footprint)+' · '+esc(d.footprintState)+'</div><div style="margin-top:5px">거시 '+f(macro.macro_score)+' · '+esc(macro.regime||'--')+' · 시장 '+esc(market.regime||'--')+'</div><div style="margin-top:8px;font-weight:800;'+(strong?'font-size:18px':'')+'">'+esc(m.label)+' · MVRV '+f(m.value)+'</div><div style="margin-top:3px">'+esc(m.guide)+'</div><div style="margin-top:8px;font-size:12px;opacity:.8">'+esc(eventText(d.events))+' · 결과보다 실제 금리/달러/유가/주식/BTC 반응 우선</div>'; }catch(e){body.textContent='큰그림 재조회 중 · '+new Date().toLocaleTimeString()}}
setTimeout(load,500);setInterval(load,60000);window.gnBigPicture=load;})();</script>`;
function patchHtml(html){if(typeof html!=="string"||!html.includes("<title>GN PIVOT</title>")||html.includes("gn-big-picture-v1"))return html;return html.replace("</body>",SCRIPT+"</body>");}
function wrappedExpress(...args){const app=previousExpress(...args);app.get("/api/big-picture",bigPicture);app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});return app;}
Object.assign(wrappedExpress,previousExpress);require.cache[expressPath].exports=wrappedExpress;