"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");
const {createClient}=require("@supabase/supabase-js");
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

const num=v=>Number.isFinite(Number(v))?Number(v):null;
async function btcMvrv(){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),8000);
  try{
    const url="https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&frequency=1d&page_size=2&paging_from=end";
    const r=await fetch(url,{signal:c.signal,headers:{accept:"application/json","user-agent":"GN-PIVOT-MVRV/1.0"}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const j=await r.json(),rows=(j?.data||[]).slice().sort((a,b)=>String(b.time).localeCompare(String(a.time)));
    const row=rows[0]||{},v=num(row.CapMVRVCur);
    return {value:v,asOf:row.time||null,source:"Coin Metrics CapMVRVCur",error:v==null?"MVRV unavailable":null};
  }catch(e){return {value:null,asOf:null,source:"Coin Metrics CapMVRVCur",error:String(e?.message||e)};}
  finally{clearTimeout(timer);}
}
function footprintState(score){
  if(score==null)return "데이터대기";
  if(score>=65)return "위험선호";
  if(score>=50)return "중립우위";
  if(score>=40)return "주의";
  return "위험회피";
}
function mvrvState(v,footprint){
  if(v==null)return {signal:"DATA_WAIT",label:"MVRV 데이터대기",guide:"데이터 확인 전 신호 없음"};
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
    const footprint=num(market?.market_score),mv=mvrvState(mvrv.value,footprint);
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