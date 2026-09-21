"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");

const WATCH=[
  {key:"LS",symbol:"010120.KS",name:"LS ELECTRIC",currency:"KRW",theme:"AI전력·전력망"},
  {key:"HD",symbol:"267260.KS",name:"HD현대일렉트릭",currency:"KRW",theme:"AI전력·변압기"},
  {key:"DOOSAN",symbol:"034020.KS",name:"두산에너빌리티",currency:"KRW",theme:"AI전력·가스터빈·원전"},
  {key:"VRT",symbol:"VRT",name:"Vertiv",currency:"USD",theme:"AI전력·냉각"},
  {key:"AVGO",symbol:"AVGO",name:"Broadcom",currency:"USD",theme:"AI네트워크·반도체"},
  {key:"GEV",symbol:"GEV",name:"GE Vernova",currency:"USD",theme:"AI전력·발전설비"}
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

function patchHtml(html){return html;}

function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.get("/api/risk-buy-fx",riskBuyFx);
  app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
