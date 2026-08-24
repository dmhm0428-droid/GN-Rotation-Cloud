"use strict";

const NEW_LISTING_DAYS=30;
const FOREIGN_EXCHANGES=[
  {name:"binance",base:"https://data-api.binance.vision"},
  {name:"mexc",base:"https://api.mexc.com"}
];

async function fetchJson(url,{fetchImpl=fetch,timeoutMs=9000}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(url,{signal:controller.signal,headers:{Accept:"application/json","User-Agent":"GN-New-Listing-Overseas-v1"}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return response.json();
  }finally{clearTimeout(timer);}
}

async function upbitListingInfo(market,{fetchImpl=fetch}={}){
  try{
    const rows=await fetchJson(`https://api.upbit.com/v1/candles/days?market=${encodeURIComponent(market)}&count=${NEW_LISTING_DAYS}`,{fetchImpl});
    if(!Array.isArray(rows)||!rows.length)return {available:false,newListing:false,ageDays:null};
    const oldest=rows.at(-1);
    const oldestTime=new Date(`${oldest.candle_date_time_utc}Z`).getTime();
    const ageDays=Number.isFinite(oldestTime)?Math.max(1,Math.floor((Date.now()-oldestTime)/86400000)+1):rows.length;
    return {available:true,newListing:rows.length<NEW_LISTING_DAYS,ageDays:rows.length<NEW_LISTING_DAYS?ageDays:null,historyDays:rows.length};
  }catch{return {available:false,newListing:false,ageDays:null};}
}

async function usdtKrw({fetchImpl=fetch}={}){
  try{
    const rows=await fetchJson("https://api.upbit.com/v1/ticker?markets=KRW-USDT",{fetchImpl});
    const value=Number(rows?.[0]?.trade_price);
    return Number.isFinite(value)&&value>0?value:null;
  }catch{return null;}
}

async function exchangeReference(exchange,symbol,{fetchImpl=fetch}={}){
  const pair=`${symbol}USDT`;
  try{
    const [ticker,first]=await Promise.all([
      fetchJson(`${exchange.base}/api/v3/ticker/price?symbol=${encodeURIComponent(pair)}`,{fetchImpl}),
      fetchJson(`${exchange.base}/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=1d&startTime=0&limit=1`,{fetchImpl})
    ]);
    const current=Number(ticker?.price);
    const firstRow=Array.isArray(first)?first[0]:null;
    const listingPrice=Number(firstRow?.[1]);
    const listingTime=Number(firstRow?.[0]);
    if(!(current>0&&listingPrice>0&&Number.isFinite(listingTime)))return null;
    return {source:exchange.name,currentUsd:current,listingUsd:listingPrice,listingTime:new Date(listingTime).toISOString(),returnFromListing:current/listingPrice-1};
  }catch{return null;}
}

function scoreAdjustment(info){
  if(!info?.available)return {scoreDelta:0,reasons:[]};
  let scoreDelta=0;
  const reasons=[];
  const r=Number(info.returnFromListing),p=Number(info.upbitPremium);
  if(Number.isFinite(r)){
    if(r>=5){scoreDelta-=6;reasons.push("FOREIGN_LISTING_500PCT_PLUS");}
    else if(r>=2){scoreDelta-=4;reasons.push("FOREIGN_LISTING_200PCT_PLUS");}
    else if(r>=1){scoreDelta-=2;reasons.push("FOREIGN_LISTING_100PCT_PLUS");}
  }
  if(Number.isFinite(p)){
    if(p>=.15){scoreDelta-=5;reasons.push("UPBIT_PREMIUM_15PCT_PLUS");}
    else if(p>=.08){scoreDelta-=3;reasons.push("UPBIT_PREMIUM_8PCT_PLUS");}
    else if(p>=.04){scoreDelta-=1;reasons.push("UPBIT_PREMIUM_4PCT_PLUS");}
    else if(p<=-.05){scoreDelta+=1;reasons.push("UPBIT_DISCOUNT_5PCT_PLUS");}
  }
  return {scoreDelta,reasons};
}

async function enrichNewListingOverseas(rows,{fetchImpl=fetch}={}){
  if(!Array.isArray(rows)||!rows.length)return rows||[];
  const fx=await usdtKrw({fetchImpl});
  return Promise.all(rows.map(async row=>{
    const listing=await upbitListingInfo(row.market,{fetchImpl});
    if(!listing.newListing)return {...row,newListing:false,newListingAgeDays:listing.ageDays,newListingHistoryDays:listing.historyDays??null};
    const symbol=String(row.market||"").replace(/^KRW-/,"");
    const refs=(await Promise.all(FOREIGN_EXCHANGES.map(exchange=>exchangeReference(exchange,symbol,{fetchImpl})))).filter(Boolean).sort((a,b)=>new Date(a.listingTime)-new Date(b.listingTime));
    const ref=refs[0]||null;
    if(!ref)return {...row,newListing:true,newListingAgeDays:listing.ageDays,newListingHistoryDays:listing.historyDays??null,overseasAvailable:false,overseasScoreDelta:0,overseasReasons:["NO_FOREIGN_REFERENCE"]};
    const krwPrice=Number(row.krwPrice),upbitPremium=Number.isFinite(krwPrice)&&krwPrice>0&&Number.isFinite(fx)&&fx>0?krwPrice/(ref.currentUsd*fx)-1:null;
    const info={available:true,source:ref.source,currentUsd:ref.currentUsd,listingUsd:ref.listingUsd,listingTime:ref.listingTime,returnFromListing:ref.returnFromListing,upbitPremium,usdtKrw:fx};
    const adj=scoreAdjustment(info);
    return {...row,newListing:true,newListingAgeDays:listing.ageDays,newListingHistoryDays:listing.historyDays??null,overseasAvailable:true,overseasSource:info.source,overseasCurrentUsd:info.currentUsd,overseasListingUsd:info.listingUsd,overseasListingTime:info.listingTime,overseasReturnFromListing:info.returnFromListing,upbitPremiumVsOverseas:info.upbitPremium,overseasUsdtKrw:info.usdtKrw,overseasScoreDelta:adj.scoreDelta,overseasReasons:adj.reasons};
  }));
}

module.exports={NEW_LISTING_DAYS,enrichNewListingOverseas,exchangeReference,scoreAdjustment,upbitListingInfo,usdtKrw};
