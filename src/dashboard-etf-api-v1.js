"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");
const {createClient}=require("@supabase/supabase-js");

const ETF_WATCHLIST=[
  {code:"487230",name:"KODEX 미국AI전력핵심인프라"},
  {code:"0173Y0",name:"KODEX 미국AI광통신네트워크"},
  {code:"491010",name:"TIGER 글로벌AI전력인프라액티브"},
  {code:"0023A0",name:"SOL 미국양자컴퓨팅TOP10"},
  {code:"449450",name:"PLUS K방산"}
];
const URL=process.env.SUPABASE_URL,KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const db=URL&&KEY?createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}}):null;
const TTL_MS=15000;
let cache={at:0,data:null};
function num(v){if(v==null)return null;const n=Number(String(v).replaceAll(",","").replaceAll("%","").trim());return Number.isFinite(n)?n:null;}
async function retirementMap(){
  if(!db)return {};
  const {data,error}=await db.from("gn_retirement_holdings").select("code,avg_price,quantity").eq("active",true);
  if(error)return {};
  return Object.fromEntries((data||[]).map(x=>[x.code,{avgPrice:num(x.avg_price),quantity:num(x.quantity)}]));
}
async function quote(item,holding){
  const c=new AbortController(),tm=setTimeout(()=>c.abort(),6000);
  try{
    const url=`https://polling.finance.naver.com/api/realtime/domestic/stock/${encodeURIComponent(item.code)}`;
    const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 GN-PIVOT/1.0","accept":"application/json"},signal:c.signal});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const p=await r.json(),q=p?.datas?.[0];if(!q)throw new Error("NO_QUOTE_DATA");
    const price=num(q.closePrice),avgPrice=holding?.avgPrice??null,quantity=holding?.quantity??null;
    const name=avgPrice!=null?`${item.name} · 평단 ${Math.round(avgPrice).toLocaleString()}원 · ${Math.round(quantity||0).toLocaleString()}주`:item.name;
    return {...item,name,avgPrice,quantity,price,pnlPct:price!=null&&avgPrice!=null?((price/avgPrice)-1)*100:null,change:num(q.compareToPreviousClosePrice),changePct:num(q.fluctuationsRatio),marketStatus:q.marketStatus||null,tradedAt:q.localTradedAt||null,source:"NAVER_FINANCE_PUBLIC_QUOTE"};
  }catch(e){return {...item,avgPrice:holding?.avgPrice??null,quantity:holding?.quantity??null,price:null,error:String(e?.name==="AbortError"?"QUOTE_TIMEOUT":e?.message||e),source:"UNAVAILABLE"};}
  finally{clearTimeout(tm);}
}
async function latest(){
  if(cache.data&&Date.now()-cache.at<TTL_MS)return cache.data;
  const holdings=await retirementMap();
  const items=await Promise.all(ETF_WATCHLIST.map(item=>quote(item,holdings[item.code])));
  const data={ts:new Date().toISOString(),items,source:"NAVER_FINANCE_PUBLIC_QUOTE",ok:items.some(x=>x.price!=null)};
  cache={at:Date.now(),data};return data;
}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.get("/api/etf/latest",async(req,res)=>{try{res.set("Cache-Control","no-store");res.json(await latest());}catch(e){res.status(500).json({error:String(e?.message||e)});}});
  return app;
}
Object.assign(wrappedExpress,previousExpress);require.cache[expressPath].exports=wrappedExpress;
