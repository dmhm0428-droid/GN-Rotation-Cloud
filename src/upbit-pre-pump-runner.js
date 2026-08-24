"use strict";

const {scanPrePump}=require("./pre-pump-scanner");
const {savePrePumpScan}=require("./pre-pump-store");
const {enrichNewListingOverseas}=require("./new-listing-overseas");

const DEFAULT_BLOCKED_MARKETS=new Set(["KRW-STORJ"]);
const ORDERBOOK_SAMPLE_DELAY_MS=900;
const HTF_CANDIDATE_POOL=12;

function blockedMarketSet(env=process.env){
  const configured=(env.PRE_PUMP_BLOCKED_MARKETS||"").split(",").map(value=>value.trim().toUpperCase()).filter(Boolean);
  return new Set([...DEFAULT_BLOCKED_MARKETS,...configured]);
}

async function filterUnsafeCandidates(rows,{fetchImpl=fetch,env=process.env}={}){
  const blocked=blockedMarketSet(env);
  let caution=new Set();
  try{
    const response=await fetchImpl("https://api.upbit.com/v1/market/all?isDetails=true",{headers:{Accept:"application/json","User-Agent":"GN-Pre-Pump-Runner-v2"}});
    if(response.ok){
      const markets=await response.json();
      caution=new Set((markets||[]).filter(row=>row?.market_warning==="CAUTION").map(row=>row.market));
    }
  }catch{}
  return (rows||[]).filter(row=>row?.market&&!blocked.has(row.market)&&!caution.has(row.market));
}

async function enrichKrwPrices(rows,{fetchImpl=fetch}={}){
  if(!rows.length)return rows;
  const markets=rows.map(row=>row.market).join(",");
  try{
    const response=await fetchImpl(`https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(markets)}`,{headers:{Accept:"application/json","User-Agent":"GN-Pre-Pump-Runner-v1"}});
    if(!response.ok)return rows;
    const tickers=await response.json();
    const prices=new Map((tickers||[]).map(row=>[row.market,Number(row.trade_price)]));
    return rows.map(row=>({...row,krwPrice:Number.isFinite(prices.get(row.market))?prices.get(row.market):null}));
  }catch{return rows;}
}

async function fetchCandles(market,unit,{fetchImpl=fetch,count=60}={}){
  const endpoint=unit==="weeks"?"weeks":"days";
  try{
    const response=await fetchImpl(`https://api.upbit.com/v1/candles/${endpoint}?market=${encodeURIComponent(market)}&count=${count}`,{headers:{Accept:"application/json","User-Agent":"GN-HTF-Pullback-v1"}});
    if(!response.ok)return [];
    const rows=await response.json();
    return Array.isArray(rows)?rows.slice().reverse():[];
  }catch{return [];}
}

function sma(values,n){
  if(values.length<n)return null;
  const a=values.slice(-n);
  return a.reduce((sum,v)=>sum+v,0)/a.length;
}

function analyzeHigherTimeframe(candles,kind){
  if(!Array.isArray(candles)||candles.length<10)return {available:false,scoreDelta:0,reasons:[`${kind}_NO_DATA`]};
  const closes=candles.map(x=>Number(x.trade_price)).filter(Number.isFinite);
  const last=candles.at(-1)||{};
  const close=Number(last.trade_price),open=Number(last.opening_price),high=Number(last.high_price),low=Number(last.low_price);
  if(![close,open,high,low].every(Number.isFinite))return {available:false,scoreDelta:0,reasons:[`${kind}_BAD_DATA`]};

  const ma5=sma(closes,5),ma10=sma(closes,10),ma20=sma(closes,20);
  const range=Math.max(high-low,Number.EPSILON);
  const upperWick=(high-Math.max(open,close))/range;
  const closePos=(close-low)/range;
  const trendUp=(ma5!=null&&ma10!=null&&ma5>=ma10)&&(ma20==null||ma10>=ma20*0.985);
  const stretched=ma20!=null?close/ma20-1:null;
  const pullbackTo10=ma10!=null?Math.abs(close/ma10-1):null;
  const pullbackTo20=ma20!=null?Math.abs(close/ma20-1):null;
  const recentHigh=Math.max(...candles.slice(-Math.min(12,candles.length)).map(x=>Number(x.high_price)||0));
  const drawdownFromHigh=recentHigh>0?close/recentHigh-1:null;

  let scoreDelta=0;
  const reasons=[];
  let entryBlocked=false;

  // Preferred structure: higher-timeframe uptrend remains intact while price has reset toward 10/20 MA.
  if(trendUp){scoreDelta+=3;reasons.push(`${kind}_UPTREND`);}
  if(trendUp&&drawdownFromHigh!=null&&drawdownFromHigh<=-.03&&drawdownFromHigh>=-.16){scoreDelta+=4;reasons.push(`${kind}_HEALTHY_PULLBACK`);}
  if(trendUp&&pullbackTo10!=null&&pullbackTo10<=.035){scoreDelta+=3;reasons.push(`${kind}_MA10_RETEST`);}
  else if(trendUp&&pullbackTo20!=null&&pullbackTo20<=.05){scoreDelta+=2;reasons.push(`${kind}_MA20_RETEST`);}

  // Avoid recommending a TOP3 candidate after the weekly/daily candle has already extended or distributed.
  if(stretched!=null&&stretched>=.22){scoreDelta-=8;entryBlocked=true;reasons.push(`${kind}_EXTENDED`);}
  else if(stretched!=null&&stretched>=.12){scoreDelta-=4;reasons.push(`${kind}_HOT`);}
  if(upperWick>=.45&&closePos<.65){scoreDelta-=7;entryBlocked=true;reasons.push(`${kind}_UPPER_WICK`);}
  else if(upperWick>=.30){scoreDelta-=3;reasons.push(`${kind}_WICK_RISK`);}
  if(ma20!=null&&close<ma20*.97){scoreDelta-=5;reasons.push(`${kind}_TREND_WEAK`);}

  return {available:true,scoreDelta,entryBlocked,trendUp,ma5,ma10,ma20,upperWick:+upperWick.toFixed(3),closePos:+closePos.toFixed(3),stretched:stretched==null?null:+stretched.toFixed(4),drawdownFromHigh:drawdownFromHigh==null?null:+drawdownFromHigh.toFixed(4),reasons};
}

async function enrichHigherTimeframePullback(rows,{fetchImpl=fetch}={}){
  return Promise.all((rows||[]).map(async row=>{
    const [dailyCandles,weeklyCandles]=await Promise.all([
      fetchCandles(row.market,"days",{fetchImpl,count:45}),
      fetchCandles(row.market,"weeks",{fetchImpl,count:35})
    ]);
    const daily=analyzeHigherTimeframe(dailyCandles,"DAILY");
    const weekly=analyzeHigherTimeframe(weeklyCandles,"WEEKLY");
    const rawDelta=(daily.scoreDelta||0)+(weekly.scoreDelta||0);
    const htfScoreDelta=Math.max(-18,Math.min(12,rawDelta));
    const htfEntryBlocked=daily.entryBlocked===true||weekly.entryBlocked===true;
    const base=Number(row.score)||0;
    let score=Math.max(0,Math.min(100,base+htfScoreDelta));
    let state=row.state;
    if(htfEntryBlocked){
      score=Math.min(score,69);
      if(state==="ENTRY")state="CONFIRM_WAIT";
    }
    return {...row,score:+score.toFixed(2),state,htfScoreDelta,htfEntryBlocked,dailyStructure:daily,weeklyStructure:weekly,htfReasons:[...(weekly.reasons||[]),...(daily.reasons||[])]};
  })).then(out=>out.sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)));
}

async function fetchOrderbooks(markets,{fetchImpl=fetch}={}){
  if(!markets.length)return new Map();
  try{
    const response=await fetchImpl(`https://api.upbit.com/v1/orderbook?markets=${encodeURIComponent(markets.join(","))}`,{headers:{Accept:"application/json","User-Agent":"GN-Pre-Pump-Orderbook-v1"}});
    if(!response.ok)return new Map();
    const rows=await response.json();
    return new Map((rows||[]).map(row=>[row.market,row]));
  }catch{return new Map();}
}

function summarizeOrderbook(book){
  const units=(book?.orderbook_units||[]).slice(0,5);
  if(!units.length)return null;
  const askTotal=units.reduce((sum,u)=>sum+(Number(u.ask_size)||0),0),bidTotal=units.reduce((sum,u)=>sum+(Number(u.bid_size)||0),0),askAverage=askTotal/units.length,bidAverage=bidTotal/units.length;
  const askWall=units.reduce((best,u)=>(Number(u.ask_size)||0)>(Number(best?.ask_size)||0)?u:best,null),bidWall=units.reduce((best,u)=>(Number(u.bid_size)||0)>(Number(best?.bid_size)||0)?u:best,null);
  return {
    units,
    askTotal,
    bidTotal,
    imbalance:askTotal+bidTotal>0?bidTotal/(askTotal+bidTotal):.5,
    bestAsk:Number(units[0]?.ask_price)||null,
    bestBid:Number(units[0]?.bid_price)||null,
    askWallPrice:Number(askWall?.ask_price)||null,
    askWallSize:Number(askWall?.ask_size)||0,
    askWallRatio:askAverage>0?(Number(askWall?.ask_size)||0)/askAverage:null,
    bidWallPrice:Number(bidWall?.bid_price)||null,
    bidWallSize:Number(bidWall?.bid_size)||0,
    bidWallRatio:bidAverage>0?(Number(bidWall?.bid_size)||0)/bidAverage:null
  };
}

function analyzeOrderbookPair(firstBook,secondBook){
  const first=summarizeOrderbook(firstBook),second=summarizeOrderbook(secondBook);
  if(!first||!second)return {available:false,signal:"UNKNOWN",scoreDelta:0,entryBlocked:false};
  const secondAtWall=second.units.find(u=>Number(u.ask_price)===first.askWallPrice),remaining=secondAtWall?Number(secondAtWall.ask_size)||0:0;
  const askWallDepletion=first.askWallSize>0?Math.max(0,Math.min(1,(first.askWallSize-remaining)/first.askWallSize)):0;
  const bestBidHeld=Number.isFinite(first.bestBid)&&Number.isFinite(second.bestBid)?second.bestBid>=first.bestBid:false;
  const bestAskLifted=Number.isFinite(first.bestAsk)&&Number.isFinite(second.bestAsk)?second.bestAsk>first.bestAsk:false;
  const bidDepthHeld=first.bidTotal>0?second.bidTotal/first.bidTotal>=.75:false;
  const askDepthFalling=first.askTotal>0?second.askTotal/first.askTotal<=.90:false;
  const wallBreak=(first.askWallRatio??0)>=1.5&&(askWallDepletion>=.45||(Number.isFinite(second.bestAsk)&&Number.isFinite(first.askWallPrice)&&second.bestAsk>first.askWallPrice));
  const bidDefense=second.imbalance>=.55&&(second.bidWallRatio??0)>=1.35&&bestBidHeld&&bidDepthHeld;
  const sellAbsorption=bestBidHeld&&bidDepthHeld&&second.imbalance>=.52&&(askWallDepletion>=.20||askDepthFalling||bestAskLifted);
  const sellPressure=second.imbalance<=.38||(!bestBidHeld&&first.bidTotal>0&&second.bidTotal/first.bidTotal<.72);
  const heavyAskWall=(second.askWallRatio??0)>=1.8&&!wallBreak&&second.imbalance<.50;
  let signal="BALANCED",scoreDelta=0,entryBlocked=false;
  if(sellPressure){signal="SELL_PRESSURE";scoreDelta=-8;entryBlocked=true;}
  else if(wallBreak){signal="WALL_BREAK";scoreDelta=5;}
  else if(sellAbsorption){signal="SELL_ABSORPTION";scoreDelta=4;}
  else if(bidDefense){signal="BID_DEFENSE";scoreDelta=3;}
  else if(heavyAskWall){signal="ASK_WALL";scoreDelta=-5;entryBlocked=true;}
  return {
    available:true,
    signal,
    scoreDelta,
    entryBlocked,
    bidImbalance:+second.imbalance.toFixed(3),
    askWallRatio:Number.isFinite(second.askWallRatio)?+second.askWallRatio.toFixed(2):null,
    bidWallRatio:Number.isFinite(second.bidWallRatio)?+second.bidWallRatio.toFixed(2):null,
    askWallDepletion:+askWallDepletion.toFixed(3),
    bestBidHeld,
    bestAskLifted,
    bidDepthHeld,
    askDepthFalling,
    bestBid:second.bestBid,
    bestAsk:second.bestAsk,
    askWallPrice:second.askWallPrice,
    bidWallPrice:second.bidWallPrice
  };
}

function individualRiskGuard(row,analysis={}){
  let penalty=0;
  const reasons=[];
  let noChase=false;
  const return15m=Number(row?.return15m),return3d=Number(row?.return3d),rsi=Number(row?.rsi14);
  if(row?.latePumpRisk===true){penalty+=12;noChase=true;reasons.push("LATE_PUMP");}
  if(row?.distributionRisk===true){penalty+=15;noChase=true;reasons.push("DISTRIBUTION");}
  if(row?.heavyOldSellWall===true){penalty+=10;noChase=true;reasons.push("OLD_SELL_WALL");}
  if(row?.htfEntryBlocked===true){penalty+=8;noChase=true;reasons.push("HTF_ENTRY_BLOCKED");}
  if(Number.isFinite(return15m)&&return15m>=.07){penalty+=10;noChase=true;reasons.push("15M_EXTENDED");}
  else if(Number.isFinite(return15m)&&return15m>=.05){penalty+=5;reasons.push("15M_HOT");}
  if(Number.isFinite(return3d)&&return3d>=.20){penalty+=12;noChase=true;reasons.push("3D_EXTENDED");}
  else if(Number.isFinite(return3d)&&return3d>=.10){penalty+=6;reasons.push("3D_HOT");}
  if(Number.isFinite(rsi)&&rsi>=75){penalty+=10;noChase=true;reasons.push("RSI_OVERHEATED");}
  else if(Number.isFinite(rsi)&&rsi>=68){penalty+=5;reasons.push("RSI_HOT");}
  if(analysis?.signal==="SELL_PRESSURE"){penalty+=10;reasons.push("SELL_PRESSURE");}
  else if(analysis?.signal==="ASK_WALL"){penalty+=6;reasons.push("ASK_WALL");}
  const overseasDelta=Number(row?.overseasScoreDelta);
  if(row?.newListing===true&&Number.isFinite(overseasDelta)&&overseasDelta<0){penalty+=Math.abs(overseasDelta);reasons.push(...(row.overseasReasons||[]));}
  const entryBlocked=noChase||analysis?.entryBlocked===true||reasons.length>=3;
  const scoreCap=noChase?64:entryBlocked?69:100;
  return {penalty,entryBlocked,noChase,scoreCap,reasons};
}

async function enrichOrderbookSignals(rows,{fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),sampleDelayMs=ORDERBOOK_SAMPLE_DELAY_MS}={}){
  if(!rows.length)return rows;
  const markets=rows.map(row=>row.market).filter(Boolean);
  const first=await fetchOrderbooks(markets,{fetchImpl});
  if(!first.size)return rows.map(row=>{
    const guard=individualRiskGuard(row,{}),baseScore=Number(row.score)||0,bonus=row.newListing===true&&Number(row.overseasScoreDelta)>0?Number(row.overseasScoreDelta):0,adjustedScore=Math.max(0,Math.min(guard.scoreCap,baseScore+bonus-guard.penalty));
    let state=row.state;if(guard.noChase)state="NO_CHASE";else if(guard.entryBlocked&&state==="ENTRY")state="CONFIRM_WAIT";
    return {...row,score:+adjustedScore.toFixed(2),state,orderbookSignal:"UNKNOWN",orderbookAvailable:false,individualRiskBlocked:guard.entryBlocked,individualRiskPenalty:guard.penalty,individualRiskReasons:guard.reasons};
  });
  await sleep(sampleDelayMs);
  const second=await fetchOrderbooks(markets,{fetchImpl});
  return rows.map(row=>{
    const analysis=analyzeOrderbookPair(first.get(row.market),second.get(row.market));
    const guard=individualRiskGuard(row,analysis);
    const baseScore=Number(row.score)||0,orderbookDelta=analysis.available?analysis.scoreDelta:0,bonus=row.newListing===true&&Number(row.overseasScoreDelta)>0?Number(row.overseasScoreDelta):0,adjustedScore=Math.max(0,Math.min(guard.scoreCap,baseScore+orderbookDelta+bonus-guard.penalty));
    let state=row.state;
    if(guard.noChase)state="NO_CHASE";
    else if(guard.entryBlocked&&state==="ENTRY")state="CONFIRM_WAIT";
    if(!analysis.available)return {...row,score:+adjustedScore.toFixed(2),state,orderbookSignal:"UNKNOWN",orderbookAvailable:false,individualRiskBlocked:guard.entryBlocked,individualRiskPenalty:guard.penalty,individualRiskReasons:guard.reasons};
    return {...row,score:+adjustedScore.toFixed(2),state,orderbookAvailable:true,orderbookSignal:analysis.signal,orderbookScoreDelta:analysis.scoreDelta,orderbookEntryBlocked:analysis.entryBlocked,orderbookBidImbalance:analysis.bidImbalance,orderbookAskWallRatio:analysis.askWallRatio,orderbookBidWallRatio:analysis.bidWallRatio,orderbookAskWallDepletion:analysis.askWallDepletion,orderbookBestBidHeld:analysis.bestBidHeld,orderbookBestAskLifted:analysis.bestAskLifted,orderbookBidDepthHeld:analysis.bidDepthHeld,orderbookAskDepthFalling:analysis.askDepthFalling,orderbookBestBid:analysis.bestBid,orderbookBestAsk:analysis.bestAsk,orderbookAskWallPrice:analysis.askWallPrice,orderbookBidWallPrice:analysis.bidWallPrice,individualRiskBlocked:guard.entryBlocked,individualRiskPenalty:guard.penalty,individualRiskReasons:guard.reasons};
  }).sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0));
}

function formatResult(row){
  return {
    market:row.market,
    score:row.score,
    status:row.state,
    krwPrice:row.krwPrice??null,
    return5m:row.return5m,
    return15m:row.return15m,
    turnoverGrowth15m:row.turnoverGrowth15m,
    htfScoreDelta:row.htfScoreDelta??0,
    htfEntryBlocked:row.htfEntryBlocked??false,
    htfReasons:row.htfReasons??[],
    weeklyStructure:row.weeklyStructure??null,
    dailyStructure:row.dailyStructure??null,
    newListing:row.newListing??false,
    newListingAgeDays:row.newListingAgeDays??null,
    overseasSource:row.overseasSource??null,
    overseasListingUsd:row.overseasListingUsd??null,
    overseasCurrentUsd:row.overseasCurrentUsd??null,
    overseasReturnFromListing:row.overseasReturnFromListing??null,
    upbitPremiumVsOverseas:row.upbitPremiumVsOverseas??null,
    overseasScoreDelta:row.overseasScoreDelta??0,
    orderbookSignal:row.orderbookSignal??"UNKNOWN",
    orderbookBidImbalance:row.orderbookBidImbalance??null,
    orderbookAskWallDepletion:row.orderbookAskWallDepletion??null,
    individualRiskBlocked:row.individualRiskBlocked??false,
    individualRiskPenalty:row.individualRiskPenalty??0,
    individualRiskReasons:row.individualRiskReasons??[]
  };
}

async function runUpbitPrePump({scanner=scanPrePump,save=savePrePumpScan,env=process.env,fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),...scanOptions}={}){
  const results=await scanner({...scanOptions,fetchImpl});
  const safeResults=await filterUnsafeCandidates(results,{fetchImpl,env});

  // TOP3 is no longer chosen from intraday pump score alone.
  // Re-rank a wider candidate pool after weekly/daily trend and pullback validation.
  const htfPool=await enrichHigherTimeframePullback(safeResults.slice(0,HTF_CANDIDATE_POOL),{fetchImpl});
  const priced=await enrichKrwPrices(htfPool.slice(0,3),{fetchImpl});
  const overseas=await enrichNewListingOverseas(priced,{fetchImpl});
  const top3=await enrichOrderbookSignals(overseas,{fetchImpl,sleep});
  try{await save({candidates:top3,env});}catch{}
  return top3.map(formatResult);
}

if(require.main===module){
  runUpbitPrePump()
    .then(results=>console.log(JSON.stringify(results,null,2)))
    .catch(error=>{console.error(`Pre-Pump scan failed: ${error?.message||"unknown error"}`);process.exitCode=1;});
}

module.exports={analyzeHigherTimeframe,analyzeOrderbookPair,blockedMarketSet,enrichHigherTimeframePullback,enrichKrwPrices,enrichOrderbookSignals,fetchCandles,fetchOrderbooks,filterUnsafeCandidates,formatResult,individualRiskGuard,runUpbitPrePump,summarizeOrderbook};
