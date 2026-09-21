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
async function fetchWithTimeout(url,timeout=6000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 GN-PIVOT/1.0","accept":"application/json"},signal:controller.signal});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }finally{clearTimeout(timer);}
}
function normalized(item,holding,q,source){
  const price=num(q?.closePrice??q?.regularMarketPrice??q?.price),
        avgPrice=holding?.avgPrice??null,
        quantity=holding?.quantity??null,
        prev=num(q?.previousClose??q?.chartPreviousClose??q?.previousClosePrice),
        change=num(q?.compareToPreviousClosePrice??q?.regularMarketChange),
        changePct=num(q?.fluctuationsRatio??q?.regularMarketChangePercent) ?? (price!=null&&prev?((price/prev)-1)*100:null),
        tradedAt=q?.localTradedAt||q?.tradedAt||(q?.regularMarketTime?new Date(Number(q.regularMarketTime)*1000).toISOString():null),
        marketStatus=q?.marketStatus||q?.marketState||null;
  if(price==null)throw new Error("NO_PRICE");
  return {...item,avgPrice,quantity,price,pnlPct:price!=null&&avgPrice!=null?((price/avgPrice)-1)*100:null,change,changePct,marketStatus,tradedAt,source};
}
async function quote(item,holding){
  const errors=[];
  try{
    const p=await fetchWithTimeout(`https://polling.finance.naver.com/api/realtime/domestic/stock/${encodeURIComponent(item.code)}`);
    const q=p?.datas?.[0];
    if(!q)throw new Error("NO_QUOTE_DATA");
    return normalized(item,holding,q,"NAVER_POLLING");
  }catch(e){errors.push("naver_polling:"+String(e?.name==="AbortError"?"TIMEOUT":e?.message||e));}
  try{
    const q=await fetchWithTimeout(`https://m.stock.naver.com/api/stock/${encodeURIComponent(item.code)}/basic`);
    return normalized(item,holding,q,"NAVER_MOBILE");
  }catch(e){errors.push("naver_mobile:"+String(e?.name==="AbortError"?"TIMEOUT":e?.message||e));}
  try{
    const j=await fetchWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.code+".KS")}?interval=1m&range=1d`);
    const meta=j?.chart?.result?.[0]?.meta;
    if(!meta)throw new Error("NO_QUOTE_DATA");
    return normalized(item,holding,meta,"YAHOO_KRX_FALLBACK");
  }catch(e){errors.push("yahoo:"+String(e?.name==="AbortError"?"TIMEOUT":e?.message||e));}
  return {...item,avgPrice:holding?.avgPrice??null,quantity:holding?.quantity??null,price:null,error:errors.join(" | "),source:"UNAVAILABLE"};
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
