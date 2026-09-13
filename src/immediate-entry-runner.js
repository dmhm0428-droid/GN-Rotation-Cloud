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
const CANDLES_PER_MARKET=181;
const BATCH_SIZE=8;
const BATCH_DELAY_MS=1100;
const RAW_POOL=24;
const VALIDATION_POOL=12;
const MIN_ENTRY_SCORE=76;
const MIN_PROBABILITY_SCORE=78;
const MAX_ENTRY_RETURN_15M=.05;
const RECENT_WATCH_MS=130*60*1000;

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
async function foreignFlow(exchange,symbol,{fetchImpl=fetch}={}){
  const pair=`${symbol}USDT`;
  try{
    const url=exchange==="binance"
      ?`https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=15m&limit=3`
      :`https://api.mexc.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=15m&limit=3`;
    const rows=await fetchJson(url,{fetchImpl});
    if(!Array.isArray(rows)||rows.length<3)return null;
    const previous=rows.at(-2),latest=rows.at(-1);
    const priorClose=finite(previous?.[4]),close=finite(latest?.[4]);
    const priorQuote=finite(previous?.[7]),quote=finite(latest?.[7]);
    if(!(priorClose>0&&close>0&&priorQuote>0&&quote>=0))return null;
    return {exchange,return15m:close/priorClose-1,quoteVolumeGrowth:quote/priorQuote-1};
  }catch{return null;}
}
function median(values){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
async function enrichGlobalSpot(rows,{fetchImpl=fetch}={}){
  const fx=await upbitUsdtKrw({fetchImpl});
  return Promise.all((rows||[]).map(async row=>{
    const symbol=String(row.market||"").replace(/^KRW-/,"");
    const [refs,flows]=await Promise.all([
      Promise.all([foreignTicker("binance",symbol,{fetchImpl}),foreignTicker("mexc",symbol,{fetchImpl})]),
      Promise.all([foreignFlow("binance",symbol,{fetchImpl}),foreignFlow("mexc",symbol,{fetchImpl})])
    ]).then(([a,b])=>[a.filter(Boolean),b.filter(Boolean)]);
    const refUsd=median(refs.map(x=>x.price));
    const krw=finite(row.krwPrice);
    const premium=krw!=null&&krw>0&&refUsd!=null&&refUsd>0&&fx!=null&&fx>0?krw/(refUsd*fx)-1:null;
    const aligned=flows.filter(x=>x.return15m>=-.003&&x.quoteVolumeGrowth>-.35);
    const globalExchangeSync=flows.length?aligned.length/flows.length:0;
    const globalSpotOk=refs.length>=2&&flows.length>=2&&globalExchangeSync>=1&&premium!=null&&Math.abs(premium)<=.05;
    return {...row,globalSpotAvailable:refs.length>=2&&flows.length>=2&&fx!=null,globalSpotOk,globalSpotVenues:refs.map(x=>x.exchange),globalSpotExchangeCount:flows.length,globalExchangeSync,globalSpotFlows:flows,globalSpotReferenceUsd:refUsd,globalSpotPremium:premium,globalUsdtKrw:fx};
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
  const {data}=await db.from("gn_runs").select("started_at,source_status").gte("started_at",since).order("started_at",{ascending:false}).limit(24);
  return (data||[]).filter(r=>String(r?.source_status?.source||"")==="pre_pump_immediate_v2");
}

function timeFlowFor(row,runs){
  const market=row.market;
  const points=[];
  for(const run of (runs||[]).slice().reverse()){
    const hit=(run?.source_status?.watchlist||[]).find(x=>x?.market===market);
    const growth=finite(hit?.turnoverGrowth15m);
    if(growth!=null)points.push({ts:run.started_at,ratio:Math.max(0,1+growth)});
  }
  const currentGrowth=finite(row.turnoverGrowth15m);
  if(currentGrowth!=null)points.push({ts:new Date().toISOString(),ratio:Math.max(0,1+currentGrowth)});
  const compact=points.slice(-8);
  if(compact.length<3)return {timeFlowAvailable:false,timeFlowScore:null,timeFlowTrend:null,timeFlowPositiveSteps:0,timeFlowSeries:compact};
  const ratios=compact.map(x=>x.ratio),first=ratios[0],latest=ratios.at(-1),prev=ratios.at(-2);
  let positive=0;for(let i=1;i<ratios.length;i++)if(ratios[i]>ratios[i-1])positive++;
  const trend=latest-first,steps=ratios.length-1,accel=latest-prev;
  let score=50;
  score+=clamp(trend*28,-28,28);
  score+=(positive/steps-.5)*30;
  if(latest>=1.2&&latest<=3.5)score+=12;else if(latest>3.5&&latest<=5)score-=5;else if(latest>5)score-=25;
  if(accel>0&&latest<4)score+=Math.min(8,accel*12);if(accel<-.35)score-=10;
  return {timeFlowAvailable:true,timeFlowScore:+clamp(score).toFixed(2),timeFlowTrend:+trend.toFixed(3),timeFlowPositiveSteps:positive,timeFlowSeries:compact};
}

function persistenceFor(row,runs){
  const market=row.market;let repeats=1,firstAt=null,firstPrice=null;
  for(const run of (runs||[]).slice().reverse()){
    const hit=(run?.source_status?.watchlist||[]).find(x=>x?.market===market);
    if(hit){repeats++;if(!firstAt){firstAt=run.started_at;firstPrice=finite(hit.krwPrice);}}
  }
  return {repeatCount:repeats,firstDetectedAt:firstAt||new Date().toISOString(),firstDetectedPrice:firstPrice??finite(row.krwPrice),...timeFlowFor(row,runs)};
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
  if(persistence?.timeFlowAvailable!==true)return null;
  const scanner=clamp(finite(row.score)??0);
  const daily=clamp(finite(row.dailyIgnitionScore)??50);
  const accum=clamp(finite(row.accumulationPersistenceScore)??50);
  const orderbook=orderbookQuality(row);
  const deriv=row.derivativeDataAvailable===true?clamp(finite(row.derivativeScore)??50):35;
  const global=row.globalSpotOk===true?90:30;
  const repeat=persistence.repeatCount>=4?100:persistence.repeatCount===3?90:persistence.repeatCount===2?75:35;
  const flow=clamp(finite(persistence.timeFlowScore)??0);
  const raw=flow*.25+scanner*.25+daily*.10+accum*.08+orderbook*.08+deriv*.08+global*.08+repeat*.08;
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
    timeFlow:persistence.timeFlowAvailable===true&&(finite(persistence.timeFlowScore)??0)>=60,
    obv:(finite(row.obvDirection)??0)>0,
    turnover:(finite(row.turnoverGrowth15m)??-1)>0,
    notExtended:r15!=null&&r15>-.01&&r15<MAX_ENTRY_RETURN_15M,
    preExpansion:row.preExpansionEligible===true&&(finite(row.return60m)==null||finite(row.return60m)<.04)&&(finite(row.extensionFromLow2h)==null||finite(row.extensionFromLow2h)<.05),
    oneHour:String(row.structure1h||"")!=="downtrend",
    htf:row.htfEntryBlocked!==true,
    daily:(finite(row.dailyIgnitionScore)??0)>=55,
    accumulation:(finite(row.accumulationPersistenceScore)??0)>=45,
    risk:row.latePumpRisk!==true&&row.distributionRisk!==true&&row.heavyOldSellWall!==true&&row.individualRiskBlocked!==true,
    orderbook:row.orderbookAvailable===true&&positiveOrderbook&&row.orderbookEntryBlocked!==true,
    globalSpot:row.globalSpotOk===true&&(finite(row.globalSpotExchangeCount)??0)>=2&&(finite(row.globalExchangeSync)??0)>=1,
    derivatives:row.derivativeDataAvailable===true&&(finite(row.derivativeScore)??0)>=45,
    pricePlan:plan.valid,
    probability:prob!=null&&prob>=MIN_PROBABILITY_SCORE
  };
  for(const [key,ok] of Object.entries(hard))if(!ok)reasons.push(key);
  const entryAllowed=Object.values(hard).every(Boolean);
  return {...row,persistence,probabilityScore:prob,timeFlowScore:persistence.timeFlowScore??null,timeFlowAvailable:persistence.timeFlowAvailable===true,lagRiskScore:lagRiskScore(row),entryPlan:plan,entryAllowed,entryReasons:reasons,state:entryAllowed?"ENTRY":String(row.state||"SCOUT")==="ENTRY"?"SCOUT":String(row.state||"SCOUT")};
}

function watchlistSummary(rows){
  return (rows||[]).slice(0,VALIDATION_POOL).map(row=>({market:row.market,score:row.score,state:row.state,krwPrice:row.krwPrice??null,turnoverGrowth15m:row.turnoverGrowth15m??null,obvDirection:row.obvDirection??null,timeFlowScore:row.timeFlowScore??null,probabilityScore:row.probabilityScore??null,lagRiskScore:row.lagRiskScore??null,entryAllowed:row.entryAllowed===true}));
}
function snapshotRow(row,runId,ts,rank){
  const p=row.persistence||{},plan=row.entryPlan||{};
  return {
    run_id:runId,ts,market:row.market,rank,score:row.probabilityScore??row.score,status:row.entryAllowed===true?"ENTRY":"WATCH",krw_price:row.krwPrice??null,
    return5m:row.return5m??null,return15m:row.return15m??null,volume_ratio15m:row.turnoverGrowth15m??null,
    details:{
      entry_allowed:row.entryAllowed===true,top3_role:row.entryAllowed===true?"GLOBAL_FLOW_VERIFIED_INVESTMENT_CANDIDATE":"PRE_EXPANSION_WATCH",decision_reason:row.entryAllowed===true?"시간흐름+즉시진입 기계검증 통과":"상승 전 감시 · 진입 금지",
      trade_plan:{entry_price:plan.entryPrice,entry_low:plan.entryLow,entry_high:plan.entryHigh,spread_pct:plan.spreadPct},
      first_detected_at:p.firstDetectedAt,first_detected_price:p.firstDetectedPrice,
      lead_lag:{probability_score:row.probabilityScore,lag_risk_score:row.lagRiskScore,repeat_count:p.repeatCount,scanner_score:row.score,time_flow_score:p.timeFlowScore??null,time_flow_available:p.timeFlowAvailable===true,time_flow_series:p.timeFlowSeries||[],rule:"T-120~NOW 거래량 시간흐름 + ENTRY>=76 + 반복>=2 + OBV + HTF + 오더북 + 해외현물 + 파생 + 후행과열배제"},
      expansion:{global_spot_ok:row.globalSpotOk===true,global_venues:row.globalSpotVenues||[],major_exchange_count:row.globalSpotExchangeCount??0,global_exchange_sync:row.globalExchangeSync??0,global_flows:row.globalSpotFlows||[],global_premium:row.globalSpotPremium??null,pre_expansion_eligible:row.preExpansionEligible===true,return_60m:row.return60m??null,return_120m:row.return120m??null,extension_from_low_2h:row.extensionFromLow2h??null,derivatives_ok:row.derivativeDataAvailable===true&&(finite(row.derivativeScore)??0)>=45,onchain_ok:row.onchainAvailable===true,onchain_neutral:row.onchainAvailable!==true},
      derivatives:{score:row.derivativeScore??null,data_available:row.derivativeDataAvailable===true},
      onchain:{available:row.onchainAvailable===true,provider_count:row.onchainProviderCount??0,score:row.onchainScore??null},
      structure:{higher_low_15m:row.higherLow15m??null,resistance_proximity_15m:row.resistanceProximity15m??null,structure_1h:row.structure1h??null,weekly:row.weeklyStructure??null,daily:row.dailyStructure??null},
      orderbook:{available:row.orderbookAvailable===true,signal:row.orderbookSignal??"UNKNOWN",entry_blocked:row.orderbookEntryBlocked??false,bid_imbalance:row.orderbookBidImbalance??null,ask_wall_depletion:row.orderbookAskWallDepletion??null,best_bid:row.orderbookBestBid??null,best_ask:row.orderbookBestAsk??null},
      daily_ignition:{score:row.dailyIgnitionScore??null,stage:row.dailyIgnitionStage??null,accumulation_score:row.accumulationPersistenceScore??null,obv_direction:row.dailyObvDirection??null},
      late_pump:{risk:row.latePumpRisk??false,penalty:row.latePumpPenalty??0,reasons:row.latePumpReasons||[]},
      empirical_validation:{mechanical_score:row.probabilityScore,lead_core:row.preExpansionEligible===true&&row.globalSpotOk===true&&p.timeFlowAvailable===true,lagging:row.preExpansionEligible!==true,recommendation_eligible:row.entryAllowed===true,repeat:p.repeatCount,time_flow_score:p.timeFlowScore??null,rule:"PRE_EXPANSION_TIME_FLOW_V4"}
    }
  };
}

async function saveRun(db,ready,watchlist){
  const startedAt=new Date().toISOString();
  const {data:run,error}=await db.from("gn_runs").insert({started_at:startedAt,status:"running",source_status:{source:"pre_pump_immediate_v2",ready_count:ready.length,watchlist:watchlistSummary(watchlist)}}).select("id").single();
  if(error)throw error;
  try{
    const rows=watchlist.slice(0,3).map((row,index)=>snapshotRow(row,run.id,startedAt,index+1));
    if(rows.length){const inserted=await db.from("gn_pre_pump_snapshots").insert(rows);if(inserted.error)throw inserted.error;}
    await db.from("gn_runs").update({finished_at:new Date().toISOString(),status:"success",source_status:{source:"pre_pump_immediate_v2",engine_version:"PRE_EXPANSION_TIME_FLOW_V4",ready_count:ready.length,stored_watch_count:rows.length,watchlist:watchlistSummary(watchlist)}}).eq("id",run.id);
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
  const assessed=onchain.map(row=>assessImmediateEntry(row,persistenceFor(row,priorRuns))).sort((a,b)=>(b.entryAllowed-a.entryAllowed)||((Number(b.probabilityScore)||0)-(Number(a.probabilityScore)||0)));
  const ready=assessed.filter(row=>row.entryAllowed).slice(0,3);
  const stored=await saveRun(db,ready,assessed);
  console.log(JSON.stringify({ok:true,...stored,ready:ready.map(row=>({market:row.market,probabilityScore:row.probabilityScore,timeFlowScore:row.timeFlowScore,entryPlan:row.entryPlan,repeatCount:row.persistence.repeatCount}))}));
  return ready;
}

if(require.main===module)main().catch(error=>{console.error(error?.stack||error?.message||error);process.exitCode=1;});
module.exports={assessImmediateEntry,derivativeMapFor,enrichGlobalSpot,enrichOnchain,entryPlan,foreignFlow,lagRiskScore,main,persistenceFor,probabilityScore,scanWide,snapshotRow,timeFlowFor,watchlistSummary};
