"use strict";

const UPBIT_BASE="https://api.upbit.com";
const CANDLES_PER_MARKET=61;
const BATCH_SIZE=8;
const BATCH_DELAY_MS=1100;

async function fetchJson(url,{fetchImpl=fetch,timeoutMs=10000}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(url,{signal:controller.signal,headers:{Accept:"application/json","User-Agent":"GN-Pre-Pump-Scanner-v1"}});
    if(!response.ok)throw new Error(`Upbit quotation API returned HTTP ${response.status}`);
    return response.json();
  }finally{clearTimeout(timer);}
}

function candleTime(candle){return new Date(`${candle.candle_date_time_utc}Z`).getTime();}
function closeAtOrBefore(candles,target){return candles.find(candle=>candleTime(candle)<=target)?.trade_price;}
function price(candle,field){
  const value=Number(candle?.[field]);
  return Number.isFinite(value)?value:Number(candle?.trade_price);
}

function calculateObvDirection(ordered){
  const chronological=ordered.slice().reverse();
  let obv=0;
  const series=[];
  for(let index=0;index<chronological.length;index++){
    if(index){
      const current=Number(chronological[index].trade_price),previous=Number(chronological[index-1].trade_price);
      const volume=Number(chronological[index].candle_acc_trade_volume)||0;
      if(current>previous)obv+=volume;
      else if(current<previous)obv-=volume;
    }
    series.push(obv);
  }
  const start=Math.max(0,series.length-16);
  const volume=chronological.slice(start+1).reduce((sum,c)=>sum+(Number(c.candle_acc_trade_volume)||0),0);
  return volume?Math.max(-1,Math.min(1,(series.at(-1)-series[start])/volume)):0;
}

function calculate15mStructure(ordered){
  const recent=ordered.slice(0,5),prior=ordered.slice(5,15),resistanceWindow=ordered.slice(15,60);
  if(recent.length<5||prior.length<10)return {higherLow:false,resistanceProximity:null};
  const recentLow=Math.min(...recent.map(c=>price(c,"low_price")));
  const priorLow=Math.min(...prior.map(c=>price(c,"low_price")));
  const resistance=resistanceWindow.length?Math.max(...resistanceWindow.map(c=>price(c,"high_price"))):null;
  const latest=Number(ordered[0].trade_price);
  return {higherLow:recentLow>priorLow,resistanceProximity:resistance&&resistance>0?latest/resistance-1:null};
}

function classify1hStructure(ordered){
  if(ordered.length<46)return "unknown";
  const chronological=ordered.slice(0,60).reverse();
  const base=chronological.slice(0,45),recent=chronological.slice(-15);
  const first=Number(base[0].trade_price),last=Number(base.at(-1).trade_price),latest=Number(recent.at(-1).trade_price);
  const high=Math.max(...base.map(c=>price(c,"high_price"))),low=Math.min(...base.map(c=>price(c,"low_price")));
  const baseChange=first>0?last/first-1:0;
  const range=first>0?(high-low)/first:Infinity;
  const recentChange=last>0?latest/last-1:0;
  if(baseChange<=-.03&&recentChange<.015)return "downtrend";
  if(Math.abs(baseChange)<=.02&&range<=.05&&latest>high)return "sideways_breakout";
  if(baseChange>0&&recentChange>=0)return "uptrend";
  return "neutral";
}

function highDistance1h(ordered){
  const recent=ordered.slice(0,60);
  if(!recent.length)return null;
  const current=Number(recent[0].trade_price);
  const high=Math.max(current,...recent.map(c=>price(c,"high_price")));
  return Number.isFinite(current)&&Number.isFinite(high)&&high>0?current/high-1:null;
}

function calculateMetrics(market,candles){
  const ordered=(candles||[]).slice().sort((a,b)=>candleTime(b)-candleTime(a));
  if(ordered.length<3)return null;
  const latest=ordered[0];
  const latestTime=candleTime(latest);
  const latestPrice=Number(latest.trade_price);
  const price5=Number(closeAtOrBefore(ordered,latestTime-5*60*1000));
  const price15=Number(closeAtOrBefore(ordered,latestTime-15*60*1000));
  if(!Number.isFinite(latestPrice)||!Number.isFinite(price5)||!Number.isFinite(price15)||price5<=0||price15<=0)return null;

  const recentStart=latestTime-14*60*1000;
  const previousStart=latestTime-29*60*1000;
  const recent=ordered.filter(c=>{const t=candleTime(c);return t>=recentStart&&t<=latestTime;});
  const previous=ordered.filter(c=>{const t=candleTime(c);return t>=previousStart&&t<recentStart;});
  if(recent.length<10||previous.length<10)return null;
  const turnover=sumTurnover(recent),previousTurnover=sumTurnover(previous);
  if(previousTurnover<=0)return null;
  const structure15m=calculate15mStructure(ordered);
  const structure1h=classify1hStructure(ordered);
  return {
    market,
    symbol:market.replace(/^KRW-/,""),
    return5m:latestPrice/price5-1,
    return15m:latestPrice/price15-1,
    turnoverGrowth15m:turnover/previousTurnover-1,
    obvDirection:calculateObvDirection(ordered),
    higherLow15m:structure15m.higherLow,
    resistanceProximity15m:structure15m.resistanceProximity,
    structure1h,
    highDistance1h:highDistance1h(ordered),
    pullbackRebreak1h:structure15m.higherLow&&structure1h==="sideways_breakout"
  };
}

function sumTurnover(candles){return candles.reduce((sum,c)=>sum+(Number(c.candle_acc_trade_price)||0),0);}
function percentileRanks(rows,key){
  const sorted=rows.map(row=>row[key]).slice().sort((a,b)=>a-b);
  const scale=Math.max(1,sorted.length-1);
  return new Map(rows.map(row=>[row.market,sorted.indexOf(row[key])/scale]));
}

function derivativeScore(data,spotReturn15m){
  if(!data)return {score:.5,overheated:false,available:false};
  const oi=Number(data.oiGrowth);
  let oiScore=.5;
  if(Number.isFinite(oi)&&spotReturn15m>0){
    if(oi>=.05)oiScore=1;
    else if(oi>=.01)oiScore=.75;
    else if(oi<=-.05)oiScore=.1;
    else if(oi<-.01)oiScore=.3;
  }

  const funding=Number(data.fundingRate);
  let fundingScore=.5;
  if(Number.isFinite(funding)){
    if(funding>.0007)fundingScore=0;
    else if(funding>=-.0001&&funding<=.0003)fundingScore=1;
    else if(funding<=.0005)fundingScore=.7;
    else if(funding<-.0005)fundingScore=.3;
  }

  const shortGrowth=Number(data.shortLiquidationGrowth),longGrowth=Number(data.longLiquidationGrowth);
  let liquidationScore=.5;
  if(Number.isFinite(shortGrowth)||Number.isFinite(longGrowth)){
    const short=Number.isFinite(shortGrowth)?shortGrowth:0;
    const long=Number.isFinite(longGrowth)?longGrowth:0;
    if(long>=2&&long>short)liquidationScore=.05;
    else if(long>=1&&long>short)liquidationScore=.2;
    else if(short>=2&&short>long)liquidationScore=1;
    else if(short>0&&short>long)liquidationScore=.75;
  }
  const overheated=(Number.isFinite(funding)&&funding>.0007)||(Number.isFinite(longGrowth)&&longGrowth>=2);
  return {score:oiScore*.4+fundingScore*.35+liquidationScore*.25,overheated,available:true};
}

function stateOf(score,overheated){
  if(overheated)return "NO_CHASE";
  if(score>=70)return "ENTRY";
  if(score>=50)return "SCOUT";
  return "WAIT";
}

function highChasePenalty(row){
  const distance=Number(row.highDistance1h);
  if(!Number.isFinite(distance)||distance<-.005||distance>0)return {points:0,entryBlocked:false};
  const pullbackRebreak=row.pullbackRebreak1h===true||(row.higherLow15m===true&&row.structure1h==="sideways_breakout");
  const shortPump=row.return15m>=.05&&row.turnoverGrowth15m>=1;
  if(shortPump&&!pullbackRebreak)return {points:8,entryBlocked:true};
  return {points:pullbackRebreak?1:3,entryBlocked:false};
}

function scoreCandidates(metrics,derivatives={}){
  const eligible=metrics.filter(row=>row&&row.return5m>0&&row.return15m>0&&row.return15m<0.10&&row.turnoverGrowth15m>0);
  if(!eligible.length)return [];
  const r5=percentileRanks(eligible,"return5m");
  const r15=percentileRanks(eligible,"return15m");
  const volume=percentileRanks(eligible,"turnoverGrowth15m");
  const obvRows=eligible.map(row=>({...row,obvDirection:Number(row.obvDirection)||0}));
  const obv=percentileRanks(obvRows,"obvDirection");
  return eligible.map(row=>{
    const proximity=resistanceScore(row.resistanceProximity15m);
    const structure15=(row.higherLow15m?.6:0)+proximity*.4;
    const structure1h={sideways_breakout:1,uptrend:.7,neutral:.45,unknown:.35,downtrend:0}[row.structure1h||"unknown"]??.35;
    const spotScore=100*(r5.get(row.market)*.18+r15.get(row.market)*.17+volume.get(row.market)*.20+obv.get(row.market)*.20+structure15*.15+structure1h*.10);
    const derivative=derivativeScore(derivatives[row.market],row.return15m);
    const prePenaltyScore=spotScore*.85+derivative.score*100*.15;
    const chase=highChasePenalty(row);
    const score=Math.max(0,prePenaltyScore-chase.points);
    let state=stateOf(score,derivative.overheated);
    if(chase.entryBlocked&&state==="ENTRY")state="SCOUT";
    return {...row,derivativeScore:+(derivative.score*100).toFixed(2),derivativeDataAvailable:derivative.available,highChasePenalty:chase.points,highChaseRisk:chase.entryBlocked,score:+score.toFixed(2),state};
  })
    .sort((a,b)=>b.score-a.score||b.turnoverGrowth15m-a.turnoverGrowth15m);
}

function rankCandidates(metrics,limit=3,derivatives={}){
  return scoreCandidates(metrics,derivatives)
    .filter(row=>row.score>=50&&(row.state==="SCOUT"||row.state==="ENTRY"))
    .slice(0,limit);
}

function resistanceScore(proximity){
  if(!Number.isFinite(proximity))return .25;
  if(proximity>=-.03&&proximity<=.01)return 1;
  if(proximity>-.08&&proximity<-.03)return .6;
  if(proximity>.01&&proximity<=.03)return .4;
  return 0;
}

async function scanPrePump({fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),batchSize=BATCH_SIZE,batchDelayMs=BATCH_DELAY_MS,derivatives={}}={}){
  const markets=await fetchJson(`${UPBIT_BASE}/v1/market/all?isDetails=false`,{fetchImpl});
  const krwMarkets=(markets||[]).map(row=>row.market).filter(market=>market?.startsWith("KRW-")).sort();
  const metrics=[];
  for(let index=0;index<krwMarkets.length;index+=batchSize){
    const batch=krwMarkets.slice(index,index+batchSize);
    const results=await Promise.allSettled(batch.map(async market=>{
      const url=`${UPBIT_BASE}/v1/candles/minutes/1?market=${encodeURIComponent(market)}&count=${CANDLES_PER_MARKET}`;
      return calculateMetrics(market,await fetchJson(url,{fetchImpl}));
    }));
    for(const result of results)if(result.status==="fulfilled"&&result.value)metrics.push(result.value);
    if(index+batchSize<krwMarkets.length)await sleep(batchDelayMs);
  }
  return rankCandidates(metrics,3,derivatives);
}

module.exports={calculate15mStructure,calculateMetrics,calculateObvDirection,classify1hStructure,derivativeScore,fetchJson,highChasePenalty,highDistance1h,rankCandidates,resistanceScore,scanPrePump,scoreCandidates,stateOf,sumTurnover};
