"use strict";

const {scanPrePump}=require("./pre-pump-scanner");
const {savePrePumpScan}=require("./pre-pump-store");

const DEFAULT_BLOCKED_MARKETS=new Set(["KRW-STORJ"]);
const ORDERBOOK_SAMPLE_DELAY_MS=900;

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
  if(Number.isFinite(return15m)&&return15m>=.07){penalty+=10;noChase=true;reasons.push("15M_EXTENDED");}
  else if(Number.isFinite(return15m)&&return15m>=.05){penalty+=5;reasons.push("15M_HOT");}
  if(Number.isFinite(return3d)&&return3d>=.20){penalty+=12;noChase=true;reasons.push("3D_EXTENDED");}
  else if(Number.isFinite(return3d)&&return3d>=.10){penalty+=6;reasons.push("3D_HOT");}
  if(Number.isFinite(rsi)&&rsi>=75){penalty+=10;noChase=true;reasons.push("RSI_OVERHEATED");}
  else if(Number.isFinite(rsi)&&rsi>=68){penalty+=5;reasons.push("RSI_HOT");}
  if(analysis?.signal==="SELL_PRESSURE"){penalty+=10;reasons.push("SELL_PRESSURE");}
  else if(analysis?.signal==="ASK_WALL"){penalty+=6;reasons.push("ASK_WALL");}
  const entryBlocked=noChase||analysis?.entryBlocked===true||reasons.length>=3;
  const scoreCap=noChase?64:entryBlocked?69:100;
  return {penalty,entryBlocked,noChase,scoreCap,reasons};
}

async function enrichOrderbookSignals(rows,{fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),sampleDelayMs=ORDERBOOK_SAMPLE_DELAY_MS}={}){
  if(!rows.length)return rows;
  const markets=rows.map(row=>row.market).filter(Boolean);
  const first=await fetchOrderbooks(markets,{fetchImpl});
  if(!first.size)return rows.map(row=>{
    const guard=individualRiskGuard(row,{}),baseScore=Number(row.score)||0,adjustedScore=Math.max(0,Math.min(guard.scoreCap,baseScore-guard.penalty));
    let state=row.state;if(guard.noChase)state="NO_CHASE";else if(guard.entryBlocked&&state==="ENTRY")state="CONFIRM_WAIT";
    return {...row,score:+adjustedScore.toFixed(2),state,orderbookSignal:"UNKNOWN",orderbookAvailable:false,individualRiskBlocked:guard.entryBlocked,individualRiskPenalty:guard.penalty,individualRiskReasons:guard.reasons};
  });
  await sleep(sampleDelayMs);
  const second=await fetchOrderbooks(markets,{fetchImpl});
  return rows.map(row=>{
    const analysis=analyzeOrderbookPair(first.get(row.market),second.get(row.market));
    const guard=individualRiskGuard(row,analysis);
    const baseScore=Number(row.score)||0,orderbookDelta=analysis.available?analysis.scoreDelta:0,adjustedScore=Math.max(0,Math.min(guard.scoreCap,baseScore+orderbookDelta-guard.penalty));
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
  const priced=await enrichKrwPrices(safeResults.slice(0,3),{fetchImpl});
  const top3=await enrichOrderbookSignals(priced,{fetchImpl,sleep});
  try{await save({candidates:top3,env});}catch{}
  return top3.map(formatResult);
}

if(require.main===module){
  runUpbitPrePump()
    .then(results=>console.log(JSON.stringify(results,null,2)))
    .catch(error=>{console.error(`Pre-Pump scan failed: ${error?.message||"unknown error"}`);process.exitCode=1;});
}

module.exports={analyzeOrderbookPair,blockedMarketSet,enrichKrwPrices,enrichOrderbookSignals,fetchOrderbooks,filterUnsafeCandidates,formatResult,individualRiskGuard,runUpbitPrePump,summarizeOrderbook};
