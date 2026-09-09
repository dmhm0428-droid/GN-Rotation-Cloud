"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");

const WATCH=[
  {key:"LS",symbol:"010120.KS",name:"LS ELECTRIC",currency:"KRW",julyLow:148000,first:[185000,195000],second:[165000,175000]},
  {key:"HD",symbol:"267260.KS",name:"HD현대일렉트릭",currency:"KRW",julyLow:538000,first:[680000,710000],second:[600000,640000]},
  {key:"VRT",symbol:"VRT",name:"Vertiv",currency:"USD",julyLow:220.92,first:[255,270],second:[225,240]},
  {key:"AVGO",symbol:"AVGO",name:"Broadcom",currency:"USD",julyLow:356.43,first:[340,350],second:[320,330]}
];

async function yahooQuote(symbol){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),4000);
  try{
    const u=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
    const r=await fetch(u,{headers:{"user-agent":"Mozilla/5.0 GN-PIVOT/1.0","accept":"application/json"},signal:c.signal});
    if(!r.ok)throw Error(`HTTP ${r.status}`);
    const p=await r.json(),m=p?.chart?.result?.[0]?.meta||{},price=Number(m.regularMarketPrice);
    return {price:Number.isFinite(price)?price:null,tradedAt:m.regularMarketTime?new Date(m.regularMarketTime*1000).toISOString():null,source:"YAHOO_FINANCE_CHART"};
  }catch(e){return {price:null,tradedAt:null,source:"UNAVAILABLE",error:String(e?.name==="AbortError"?"QUOTE_TIMEOUT":e?.message||e)}}finally{clearTimeout(timer)}
}

async function riskBuyFx(req,res){
  const settled=await Promise.all([...WATCH.map(x=>yahooQuote(x.symbol)),yahooQuote("KRW=X")]);
  const items=WATCH.map((x,i)=>({...x,...settled[i]}));
  const fx=settled[settled.length-1];
  res.set("Cache-Control","no-store");
  return res.json({ts:new Date().toISOString(),fx:{pair:"USD/KRW",...fx,watch:1350,risk:1380},items});
}

const BLOCK=`
<div class="section" id="riskBuyFxSection"><div class="head"><b>단기 리스크 급락 매수 4</b><span class="muted">환율 포함 · 4개만</span></div>
<div id="fxGuard" class="row"><b>USD/KRW</b><span>현재 -- · 1,350 경계 · 1,380 위험</span></div>
<div id="riskBuy4" class="rbgrid"></div></div>`;
const STYLE=`.rbgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.rbcard{background:#11161c;border:1px solid #2d3945;border-radius:16px;padding:13px}.rbline{display:flex;justify-content:space-between;gap:8px;align-items:baseline}.rbname{font-size:13px;font-weight:900}.rbprice{font-size:18px;font-weight:950}.rbmeta{font-size:11px;color:#91a0ad;line-height:1.55;margin-top:6px}.rbnear{margin-top:7px;font-size:12px;font-weight:850}@media(max-width:620px){.rbgrid{grid-template-columns:1fr}}`;
const SCRIPT=`<script id="gn-risk-buy-fx-v1">(function(){
const n=v=>Number(v),ok=v=>Number.isFinite(n(v)),fmt=(v,c)=>!ok(v)?'--':c==='KRW'?Math.round(n(v)).toLocaleString()+'원':'$'+n(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
function dist(price,range){if(!ok(price))return '--';const p=n(price),lo=n(range[0]),hi=n(range[1]);if(p>=lo&&p<=hi)return '1차 구간';if(p<lo)return '1차 하회';return '1차까지 -'+(((p-hi)/p)*100).toFixed(1)+'%';}
function fxState(v){if(!ok(v))return '';v=n(v);if(v>=1380)return ' · 위험';if(v>=1350)return ' · 경계';return ' · 안정구간';}
async function load(){try{const r=await fetch('/api/risk-buy-fx?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json();const fx=document.getElementById('fxGuard');if(fx)fx.innerHTML='<b>USD/KRW</b><span>현재 '+(ok(d?.fx?.price)?n(d.fx.price).toFixed(1):'--')+' · 1,350 경계 · 1,380 위험'+fxState(d?.fx?.price)+'</span>';const box=document.getElementById('riskBuy4');if(box)box.innerHTML=(d.items||[]).map(x=>'<div class="rbcard"><div class="rbline"><span class="rbname">'+x.name+'</span><span class="rbprice">'+fmt(x.price,x.currency)+'</span></div><div class="rbmeta">7월 저가 '+fmt(x.julyLow,x.currency)+'<br>1차 '+fmt(x.first[0],x.currency)+'~'+fmt(x.first[1],x.currency)+' · 2차 '+fmt(x.second[0],x.currency)+'~'+fmt(x.second[1],x.currency)+'</div><div class="rbnear">'+dist(x.price,x.first)+'</div></div>').join('');}catch(_){const box=document.getElementById('riskBuy4');if(box&&!box.innerHTML)box.innerHTML='<div class="empty">가격 재조회 중</div>'}}
setTimeout(load,250);setInterval(load,15000);})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("gn-risk-buy-fx-v1"))return html;
  html=html.replace("</style>",STYLE+"</style>");
  const marker='<div class="section"><div class="head"><b>Pre-Pump TOP3</b>';
  if(html.includes(marker))html=html.replace(marker,BLOCK+marker);
  else html=html.replace("</body>",BLOCK+"</body>");
  return html.replace("</body>",SCRIPT+"</body>");
}

function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.get("/api/risk-buy-fx",riskBuyFx);
  app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
