"use strict";

const {createClient}=require("@supabase/supabase-js");
const {
  calculateMetrics,scoreCandidates,enrichLatePumpRisk,fetchJson
}=require("./pre-pump-scanner");
const {
  filterUnsafeCandidates,enrichHigherTimeframePullback,enrichKrwPrices,enrichOrderbookSignals
}=require("./upbit-pre-pump-runner");
const {enrichNewListingOverseas}=require("./new-listing-overseas");

const UPBIT_BASE="https://api.upbit.com";
const CANDLES_PER_MARKET=61;
const BATCH_SIZE=8;
const BATCH_DELAY_MS=1100;
const RAW_POOL=24;
const VALIDATION_POOL=12;
const MIN_ENTRY_SCORE=76;
const MIN_PROBABILITY_SCORE=78;
const MAX_ENTRY_RETURN_15M=.05;
const RECENT_WATCH_MS=45*60*1000;

const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
const finite=v=>Number.isFinite(Number(v))?Number(v):null;
const sleepDefault=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function dbFromEnv(env=process.env){
  const url=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

async function fetchDerivative(market,{fetchImpl=fetch}={}){
  const symbol=String(market||"").replace(/^KRW-/,"")+"USDT";
  if(!symbol||symbol==="USDT")return null;
  try{
    const [premium,history]=await Promise.all([
      fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`,{fetchImpl}),
      fetchJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=15m&limit=2`,{fetchImpl})
    ]);
    const fundingRate=finite(premium?.lastFundingRate);
    const h=Array.isArray(history)?history:[];
    const prev=finite(h.at(-2)?.sumOpenInterest),last=finite(h.at(-1)?.sumOpenInterest);
    const oiGrowth=prev!=null&&prev>0&&last!=null?last/prev-1:null;
    if(fundingRate==null&&oiGrowth==null)return null;
    return {fundingRate,oiGrowth,shortLiquidationGrowth:null,longLiquidationGrowth:null};
  }catch{return null;}
}

async function derivativeMapFor(rows,{fetchImpl=fetch}={}){
  const entries=await Promise.all((rows||[]).map(async row=>[row.market,await fetchDerivative(row.market,{fetchImpl})]));
  return Object.fromEntries(entries.filter(([,value])=>value));
}

async function scanWide({fetchImpl=fetch,sleep=sleepDefault}={}){
  const markets=await fetchJson(`${UPBIT_BASE}/v1/market/all?isDetails=false`,{fetchImpl});
  const krwMarkets=(markets||[]).map(row=>row.market).filter(m=>m?.startsWith("KRW-")).sort();
  const metrics=[];
  for(let index=0;index<krwMarkets.length;index+=BATCH_SIZE){
    const batch=krwMarkets.slice(index,index+BATCH_SIZE);
    const settled=await Promise.allSettled(batch.map(async market=>{
      const candles=await fetchJson(`${UPBIT_BASE}/v1/candles/minutes/1?market=${encodeURIComponent(market)}&count=${CANDLES_PER_MARKET}`,{fetchImpl});
      return calculateMetrics(market,candles);
    }));
    for(const item of settled)if(item.status==="fulfilled"&&item.value)metrics.push(item.value);
    if(index+BATCH_SIZE<krwMarkets.length)await sleep(BATCH_DELAY_MS);
  }
  const firstPass=scoreCandidates(metrics,{}).filter(row=>Number(row.score)>=45).slice(0,RAW_POOL);
  const derivatives=await derivativeMapFor(firstPass,{fetchImpl});
  const rescored=scoreCandidates(metrics,derivatives).filter(row=>Number(row.score)>=45).slice(0,RAW_POOL);
  return enrichLatePumpRisk(rescored,{fetchImpl,limit:RAW_POOL});
}

async function upbitUsdtKrw({fetchImpl=fetch}={}){
  try{
    const rows=await fetchJson(`${UPBIT_BASE}/v1/ticker?markets=KRW-USDT`,{fetchImpl});
    const px=finite(rows?.[0]?.trade_price);return px&&px>0?px:null;
  }catch{return null;}
}
async function foreignTicker(exchange,symbol,{fetchImpl=fetch}={}){
  const pair=`${symbol}USDT`;
  try{
    const url=exchange==="binance"
      ?`https://data-api.binance.vision/api/v3/ticker/price?symbol=${encodeURIComponent(pair)}`
      :`https://api.mexc.com/api/v3/ticker/price?symbol=${encodeURIComponent(pair)}`;
    const body=await fetchJson(url,{fetchImpl});const px=finite(body?.price);return px&&px>0?{exchange,price:px}:null;
  }catch{return null;}
}
function median(values){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
async function enrichGlobalSpot(rows,{fetchImpl=fetch}={}){
  const fx=await upbitUsdtKrw({fetchImpl});
  return Promise.all((rows||[]).map(async row=>{
    const symbol=String(row.market||"").replace(/^KRW-/,"");
    const refs=(await Promise.all([foreignTicker("binance",symbol,{fetchImpl}),foreignTicker("mexc",symbol,{fetchImpl})])).filter(Boolean);
    const refUsd=median(refs.map(x=>x.price));
    const krw=finite(row.krwPrice);
    const premium=krw!=null&&krw>0&&refUsd!=null&&refUsd>0&&fx!=null&&fx>0?krw/(refUsd*fx)-1:null;
    const globalSpotOk=refs.length>=1&&premium!=null&&Math.abs(premium)<=.08;
    return {...row,globalSpotAvailable:refs.length>0&&fx!=null,globalSpotOk,globalSpotVenues:refs.map(x=>x.exchange),globalSpotReferenceUsd:refUsd,globalSpotPremium:premium,globalUsdtKrw:fx};
  }));
}

async function enrichOnchain(rows,db){
  const symbols=(rows||[]).map(row=>String(row.market||"").replace(/^KRW-/,"")).filter(Boolean);
  if(!symbols.length)return rows||[];
  let data=[];
  try{
    const result=await db.from("gn_latest_onchain_scores").select("*").in("symbol",symbols).order("ts",{ascending:false});
    if(!result.error)data=result.data||[];
  }catch{}
  const by=new Map();for(const item of data){const symbol=String(item?.symbol||"");if(symbol&&!by.has(symbol))by.set(symbol,item);}
  return (rows||[]).map(row=>{
    const symbol=String(row.market||"").replace(/^KRW-/,"");const item=by.get(symbol)||null;
    const providers=finite(item?.provider_count)??0;
    return {...row,onchainAvailable:providers>0,onchainProviderCount:providers,onchainScore:finite(item?.score??item?.flow_score??item?.composite_score),onchainRaw:item};
  });
}

async function recentWatchRuns(db){
  const since=new Date(Date.now()-RECENT_WATCH_MS).toISOString();
  const {data}=await db.from("gn_runs").select("started_at,source_status").gte("started_at",since).order("started_at",{ascending:false}).limit(8);
  return (data||[]).filter(r=>String(r?.source_status?.source||"")==="pre_pump_immediate_v2");
}
function persistenceFor(row,runs){
  const market=row.market;let repeats=1,firstAt=null,firstPrice=null;
  for(const run of (runs||[]).slice().reverse()){
    const hit=(run?.source_status?.watchlist||[]).find(x=>x?.market===market);
    if(hit){repeats++;if(!firstAt){firstAt=run.started_at;firstPrice=finite(hit.krwPrice);}}
  }
  return {repeatCount:repeats,firstDetectedAt:firstAt||new Date().toISOString(),firstDetectedPrice:firstPrice??finite(row.krwPrice)};
}

function orderbookQuality(row){
  const signal=String(row?.orderbookSignal||"");
  if(signal==="WALL_BREAK")return 95;
  if(signal==="SELL_ABSORPTION")return 90;
  if(signal==="BID_DEFENSE")return 84;
  if(signal==="BALANCED")return 55;
  if(signal==="ASK_WALL")return 25;
  if(signal==="SELL_PRESSURE")return 10;
  return 40;
}
function lagRiskScore(row){
  let risk=0;
  if(row.latePumpRisk===true)risk+=25;
  if(row.distributionRisk===true)risk+=20;
  if(row.heavyOldSellWall===true)risk+=16;
  if(row.htfEntryBlocked===true)risk+=16;
  if(row.individualRiskBlocked===true)risk+=14;
  if(row.orderbookEntryBlocked===true)risk+=14;
  if(row.highChaseRisk===true)risk+=12;
  const r15=finite(row.return15m),r3=finite(row.return3d),rsi=finite(row.rsi14??row.dailyRsi);
  if(r15!=null&&r15>=.07)risk+=18;else if(r15!=null&&r15>=.05)risk+=10;
  if(r3!=null&&r3>=.20)risk+=15;else if(r3!=null&&r3>=.10)risk+=7;
  if(rsi!=null&&rsi>=75)risk+=14;else if(rsi!=null&&rsi>=68)risk+=6;
  if(row.globalSpotOk!==true)risk+=12;
  if(row.derivativeDataAvailable!==true)risk+=10;
  return clamp(risk);
}
function probabilityScore(row,persistence){
  const scanner=clamp(finite(row.score)??0);
  const daily=clamp(finite(row.dailyIgnitionScore)??50);
  const accum=clamp(finite(row.accumulationPersistenceScore)??50);
  const orderbook=orderbookQuality(row);
  const deriv=row.derivativeDataAvailable===true?clamp(finite(row.derivativeScore)??50):35;
  const global=row.globalSpotOk===true?90:30;
  const repeat=persistence.repeatCount>=3?100:persistence.repeatCount===2?82:40;
  const raw=scanner*.40+daily*.15+accum*.10+orderbook*.10+deriv*.10+global*.10+repeat*.05;
  return +clamp(raw-lagRiskScore(row)*.45).toFixed(2);
}
function entryPlan(row){
  const px=finite(row.krwPrice),ask=finite(row.orderbookBestAsk),bid=finite(row.orderbookBestBid);
  if(!(px>0))return {valid:false,entryPrice:null,entryLow:null,entryHigh:null,spreadPct:null};
  const entryPrice=ask&&ask>0?ask:px;
  const entryLow=bid&&bid>0?bid:px*.998;
  const entryHigh=ask&&ask>0?ask:px*1.002;
  const mid=ask&&bid&&ask>0&&bid>0?(ask+bid)/2:px;
  const spreadPct=ask&&bid&&mid>0?(ask-bid)/mid:null;
  const valid=entryLow>0&&entryHigh>=entryLow&&entryHigh<=px*1.01&&(spreadPct==null||spreadPct<=.008);
  return {valid,entryPrice:+entryPrice.toFixed(8),entryLow:+entryLow.toFixed(8),entryHigh:+entryHigh.toFixed(8),spreadPct:spreadPct==null?null:+spreadPct.toFixed(6)};
}
function assessImmediateEntry(row,persistence){
  const reasons=[];const score=finite(row.score)??0;const r15=finite(row.return15m);const prob=probabilityScore(row,persistence);const plan=entryPlan(row);
  const positiveOrderbook=["WALL_BREAK","SELL_ABSORPTION","BID_DEFENSE"].includes(String(row.orderbookSignal||""));
  const hard={
    scannerEntry:String(row.state||"")==="ENTRY"&&score>=MIN_ENTRY_SCORE,
    repeat:persistence.repeatCount>=2,
    obv:(finite(row.obvDirection)??0)>0,
    turnover:(finite(row.turnoverGrowth15m)??-1)>0,
    notExtended:r15!=null&&r15>-.01&&r15<MAX_ENTRY_RETURN_15M,
    oneHour:String(row.structure1h||"")!=="downtrend",
    htf:row.htfEntryBlocked!==true,
    daily:(finite(row.dailyIgnitionScore)??0)>=55,
    accumulation:(finite(row.accumulationPersistenceScore)??0)>=45,
    risk:row.latePumpRisk!==true&&row.distributionRisk!==true&&row.heavyOldSellWall!==true&&row.individualRiskBlocked!==true,
    orderbook:row.orderbookAvailable===true&&positiveOrderbook&&row.orderbookEntryBlocked!==true,
    globalSpot:row.globalSpotOk===true,
    derivatives:row.derivativeDataAvailable===true&&(finite(row.derivativeScore)??0)>=45,
    pricePlan:plan.valid,
    probability:prob>=MIN_PROBABILITY_SCORE
  };
  for(const [key,ok] of Object.entries(hard))if(!ok)reasons.push(key);
  const entryAllowed=Object.values(hard).every(Boolean);
  return {...row,persistence,probabilityScore:prob,lagRiskScore:lagRiskScore(row),entryPlan:plan,entryAllowed,entryReasons:reasons,state:entryAllowed?"ENTRY":String(row.state||"SCOUT")==="ENTRY"?"SCOUT":String(row.state||"SCOUT")};
}

function watchlistSummary(rows){
  return (rows||[]).slice(0,VALIDATION_POOL).map(row=>({market:row.market,score:row.score,state:row.state,krwPrice:row.krwPrice??null,probabilityScore:row.probabilityScore??null,lagRiskScore:row.lagRiskScore??null,entryAllowed:row.entryAllowed===true}));
}
function snapshotRow(row,runId,ts,rank){
  const p=row.persistence||{},plan=row.entryPlan||{};
  return {
    run_id:runId,ts,market:row.market,rank,score:row.probabilityScore??row.score,status:"ENTRY",krw_price:row.krwPrice??null,
    return5m:row.return5m??null,return15m:row.return15m??null,volume_ratio15m:row.turnoverGrowth15m??null,
    details:{
      entry_allowed:true,top3_role:"GLOBAL_FLOW_VERIFIED_INVESTMENT_CANDIDATE",decision_reason:"즉시진입 기계검증 통과 · 5AI 최종게이트 대기",
      trade_plan:{entry_price:plan.entryPrice,entry_low:plan.entryLow,entry_high:plan.entryHigh,spread_pct:plan.spreadPct},
      first_detected_at:p.firstDetectedAt,first_detected_price:p.firstDetectedPrice,
      lead_lag:{probability_score:row.probabilityScore,lag_risk_score:row.lagRiskScore,repeat_count:p.repeatCount,scanner_score:row.score,rule:"ENTRY>=76 + 반복>=2 + OBV/거래대금 + HTF + 오더북 + 해외현물 + 파생 + 후행과열배제"},
      expansion:{global_spot_ok:row.globalSpotOk===true,global_venues:row.globalSpotVenues||[],global_premium:row.globalSpotPremium??null,derivatives_ok:row.derivativeDataAvailable===true&&(finite(row.derivativeScore)??0)>=45,onchain_ok:row.onchainAvailable===true,onchain_neutral:row.onchainAvailable!==true},
      derivatives:{score:row.derivativeScore??null,data_available:row.derivativeDataAvailable===true},
      onchain:{available:row.onchainAvailable===true,provider_count:row.onchainProviderCount??0,score:row.onchainScore??null},
      structure:{higher_low_15m:row.higherLow15m??null,resistance_proximity_15m:row.resistanceProximity15m??null,structure_1h:row.structure1h??null,weekly:row.weeklyStructure??null,daily:row.dailyStructure??null},
      orderbook:{available:row.orderbookAvailable===true,signal:row.orderbookSignal??"UNKNOWN",entry_blocked:row.orderbookEntryBlocked??false,bid_imbalance:row.orderbookBidImbalance??null,ask_wall_depletion:row.orderbookAskWallDepletion??null,best_bid:row.orderbookBestBid??null,best_ask:row.orderbookBestAsk??null},
      daily_ignition:{score:row.dailyIgnitionScore??null,stage:row.dailyIgnitionStage??null,accumulation_score:row.accumulationPersistenceScore??null,obv_direction:row.dailyObvDirection??null},
      late_pump:{risk:row.latePumpRisk??false,penalty:row.latePumpPenalty??0,reasons:row.latePumpReasons||[]},
      empirical_validation:{mechanical_score:row.probabilityScore,lead_core:true,lagging:false,recommendation_eligible:true,repeat:p.repeatCount,rule:"IMMEDIATE_ENTRY_V2"}
    }
  };
}

async function saveRun(db,ready,watchlist){
  const startedAt=new Date().toISOString();
  const {data:run,error}=await db.from("gn_runs").insert({started_at:startedAt,status:"running",source_status:{source:"pre_pump_immediate_v2",ready_count:ready.length,watchlist:watchlistSummary(watchlist)}}).select("id").single();
  if(error)throw error;
  try{
    const rows=ready.slice(0,3).map((row,index)=>snapshotRow(row,run.id,startedAt,index+1));
    if(rows.length){const inserted=await db.from("gn_pre_pump_snapshots").insert(rows);if(inserted.error)throw inserted.error;}
    await db.from("gn_runs").update({finished_at:new Date().toISOString(),status:"success",source_status:{source:"pre_pump_immediate_v2",ready_count:rows.length,watchlist:watchlistSummary(watchlist)}}).eq("id",run.id);
    return {runId:run.id,ts:startedAt,stored:rows.length};
  }catch(error){await db.from("gn_runs").update({finished_at:new Date().toISOString(),status:"error",error:String(error?.message||error)}).eq("id",run.id);throw error;}
}

async function main({env=process.env,fetchImpl=fetch,sleep=sleepDefault,db=dbFromEnv(env)}={}){
  const priorRuns=await recentWatchRuns(db);
  const scanned=await scanWide({fetchImpl,sleep});
  const safe=await filterUnsafeCandidates(scanned,{fetchImpl,env});
  const htf=await enrichHigherTimeframePullback(safe.slice(0,VALIDATION_POOL),{fetchImpl});
  const priced=await enrichKrwPrices(htf,{fetchImpl});
  const overseas=await enrichNewListingOverseas(priced,{fetchImpl});
  const orderbook=await enrichOrderbookSignals(overseas,{fetchImpl,sleep});
  const global=await enrichGlobalSpot(orderbook,{fetchImpl});
  const onchain=await enrichOnchain(global,db);
  const assessed=onchain.map(row=>assessImmediateEntry(row,persistenceFor(row,priorRuns))).sort((a,b)=>(b.entryAllowed-a.entryAllowed)||(Number(b.probabilityScore)-Number(a.probabilityScore)));
  const ready=assessed.filter(row=>row.entryAllowed).slice(0,3);
  const stored=await saveRun(db,ready,assessed);
  console.log(JSON.stringify({ok:true,...stored,ready:ready.map(row=>({market:row.market,probabilityScore:row.probabilityScore,entryPlan:row.entryPlan,repeatCount:row.persistence.repeatCount}))}));
  return ready;
}

if(require.main===module)main().catch(error=>{console.error(error?.stack||error?.message||error);process.exitCode=1;});
module.exports={assessImmediateEntry,derivativeMapFor,enrichGlobalSpot,enrichOnchain,entryPlan,lagRiskScore,main,persistenceFor,probabilityScore,scanWide,snapshotRow,watchlistSummary};
