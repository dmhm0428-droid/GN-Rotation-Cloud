"use strict";

const expressPath=require.resolve("express");
const previousExpress=require("express");
const {analyzeSeries,combineFourHourChecks}=require("./four-hour-chase-policy");

const UPBIT="https://api.upbit.com";
const BINANCE="https://data-api.binance.vision";
const CACHE_MS=60*1000;
const cache=new Map();

async function fetchJson(url,timeoutMs=4500){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{signal:controller.signal,headers:{accept:"application/json","user-agent":"GN-4H-Chase-Guard-v1"}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }finally{clearTimeout(timer);}
}

async function checkMarket(market){
  const key=String(market||"");
  const hit=cache.get(key);
  if(hit&&Date.now()-hit.ts<CACHE_MS)return hit.value;
  const symbol=key.replace(/^KRW-/,"");
  const calls=[
    fetchJson(`${UPBIT}/v1/candles/minutes/240?market=${encodeURIComponent(key)}&count=30`).then(x=>analyzeSeries(x,{kind:"upbit"})).catch(()=>({available:false,source:"upbit",reasons:["Upbit 4H 미확인"]})),
    fetchJson(`${BINANCE}/api/v3/klines?symbol=${encodeURIComponent(symbol)}USDT&interval=4h&limit=30`).then(x=>analyzeSeries(x,{kind:"binance"})).catch(()=>({available:false,source:"binance",reasons:["Binance 4H 미확인"]}))
  ];
  const value=combineFourHourChecks(await Promise.all(calls));
  cache.set(key,{ts:Date.now(),value});
  return value;
}

function demoteUnverified(row,guard){
  const status=String(row?.scannerStatus||row?.status||"").toUpperCase();
  if(guard?.available!==false||status!=="ENTRY")return {...row,fourHourGuard:guard};
  return {...row,fourHourGuard:guard,scannerStatus:"SCOUT",status:"SCOUT",top3Stage:"SCOUT",entryAllowed:false,strictImmediate:false,entryReadiness:false,entryBlockReason:"4H 검증 데이터 미확인"};
}

async function enforceFourHourGuard(body){
  if(!body||typeof body!=="object"||Array.isArray(body))return body;
  const primary=Array.isArray(body.cryptoRadar)?body.cryptoRadar:[];
  const near=Array.isArray(body.cryptoNearMiss)?body.cryptoNearMiss:[];
  const pool=[];const seen=new Set();
  for(const row of [...primary,...near]){
    const market=String(row?.market||"");
    if(!market||seen.has(market))continue;
    seen.add(market);pool.push(row);
    if(pool.length>=6)break;
  }
  if(!pool.length)return {...body,crypto4hGuardPolicy:"4H live no-chase guard · Upbit+Binance cross-check"};

  const checked=await Promise.all(pool.map(async row=>{
    const guard=await checkMarket(row.market);
    const adjusted=demoteUnverified(row,guard);
    if(guard.blockTop3!==true)return {...adjusted,fourHourNoChase:false};
    const lag=[...(Array.isArray(adjusted.lagReasons)?adjusted.lagReasons:[]),...(guard.reasons||[]),"4H 꼭대기/추격 구간"];
    return {...adjusted,fourHourNoChase:true,isLagging:true,entryAllowed:false,strictImmediate:false,entryReadiness:false,scannerStatus:"NO_CHASE",status:"NO_CHASE",top3Stage:"NO_CHASE",entryBlockReason:"4H 꼭대기/추격 구간",lagReasons:[...new Set(lag)]};
  }));

  const allowed=checked.filter(x=>x.fourHourNoChase!==true);
  const blocked=checked.filter(x=>x.fourHourNoChase===true);
  const top3=allowed.slice(0,3).map((x,i)=>({...x,top3Rank:i+1}));
  const selected=new Set(top3.map(x=>String(x.market||"")));
  const nextNear=[...allowed.filter(x=>!selected.has(String(x.market||""))),...blocked].slice(0,6).map((x,i)=>({...x,nearMissRank:i+1}));

  return {...body,
    cryptoRadar:top3,
    cryptoNearMiss:nextNear,
    crypto4hGuardPolicy:"4H live no-chase guard · Upbit+Binance 교차확인 · BB상단85%/스윙고점1%/MA20이격2.5%/현재4H+3%, 2개 이상 또는 극단값이면 TOP3 제외",
    crypto4hBlockedCount:blocked.length,
    crypto4hCheckedAt:new Date().toISOString()
  };
}

function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{
    if(req.path==="/api/live-summary"){
      const json=res.json.bind(res);
      res.json=function(body){Promise.resolve(enforceFourHourGuard(body)).then(out=>json(out)).catch(()=>json(body));return res;};
    }
    next();
  });
  return app;
}

Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
module.exports={checkMarket,demoteUnverified,enforceFourHourGuard};
