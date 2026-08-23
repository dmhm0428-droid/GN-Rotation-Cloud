"use strict";

const UPBIT_BASE="https://api.upbit.com";
const CANDLES_PER_MARKET=61;
const BATCH_SIZE=8;
const BATCH_DELAY_MS=1100;
const DAILY_RISK_COUNT=35;
const DAILY_RISK_TOP_N=15;

async function fetchJson(url,{fetchImpl=fetch,timeoutMs=10000}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(url,{signal:controller.signal,headers:{Accept:"application/json","User-Agent":"GN-Pre-Pump-Scanner-v2"}});
    if(!response.ok)throw new Error(`Upbit quotation API returned HTTP ${response.status}`);
    return response.json();
  }finally{clearTimeout(timer);}
}

function candleTime(candle){return new Date(`${candle.candle_date_time_utc}Z`).getTime();}
function closeAtOrBefore(candles,target){return candles.find(candle=>candleTime(candle)<=target)?.trade_price;}
function price(candle,field){const value=Number(candle?.[field]);return Number.isFinite(value)?value:Number(candle?.trade_price);}
function sumTurnover(candles){return candles.reduce((sum,c)=>sum+(Number(c.candle_acc_trade_price)||0),0);}
function mean(values){const valid=values.map(Number).filter(Number.isFinite);return valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null;}

function calculateObvDirection(ordered){
  const chronological=ordered.slice().reverse();
  let obv=0;const series=[];
  for(let index=0;index<chronological.length;index++){
    if(index){const current=Number(chronological[index].trade_price),previous=Number(chronological[index-1].trade_price);const volume=Number(chronological[index].candle_acc_trade_volume)||0;if(current>previous)obv+=volume;else if(current<previous)obv-=volume;}
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
  const recent=ordered.slice(0,60);if(!recent.length)return null;
  const current=Number(recent[0].trade_price);const high=Math.max(current,...recent.map(c=>price(c,"high_price")));
  return Number.isFinite(current)&&Number.isFinite(high)&&high>0?current/high-1:null;
}

function calculateMetrics(market,candles){
  const ordered=(candles||[]).slice().sort((a,b)=>candleTime(b)-candleTime(a));
  if(ordered.length<3)return null;
  const latest=ordered[0],latestTime=candleTime(latest),latestPrice=Number(latest.trade_price);
  const price5=Number(closeAtOrBefore(ordered,latestTime-5*60*1000));
  const price15=Number(closeAtOrBefore(ordered,latestTime-15*60*1000));
  if(!Number.isFinite(latestPrice)||!Number.isFinite(price5)||!Number.isFinite(price15)||price5<=0||price15<=0)return null;
  const recentStart=latestTime-14*60*1000,previousStart=latestTime-29*60*1000;
  const recent=ordered.filter(c=>{const t=candleTime(c);return t>=recentStart&&t<=latestTime;});
  const previous=ordered.filter(c=>{const t=candleTime(c);return t>=previousStart&&t<recentStart;});
  if(recent.length<10||previous.length<10)return null;
  const turnover=sumTurnover(recent),previousTurnover=sumTurnover(previous);if(previousTurnover<=0)return null;
  const structure15m=calculate15mStructure(ordered),structure1h=classify1hStructure(ordered);
  return {market,symbol:market.replace(/^KRW-/,""),return5m:latestPrice/price5-1,return15m:latestPrice/price15-1,turnoverGrowth15m:turnover/previousTurnover-1,obvDirection:calculateObvDirection(ordered),higherLow15m:structure15m.higherLow,resistanceProximity15m:structure15m.resistanceProximity,structure1h,highDistance1h:highDistance1h(ordered),pullbackRebreak1h:structure15m.higherLow&&structure1h==="sideways_breakout"};
}

function percentileRanks(rows,key){const sorted=rows.map(row=>row[key]).slice().sort((a,b)=>a-b);const scale=Math.max(1,sorted.length-1);return new Map(rows.map(row=>[row.market,sorted.indexOf(row[key])/scale]));}

function derivativeScore(data,spotReturn15m){
  if(!data)return {score:.5,overheated:false,available:false};
  const oi=Number(data.oiGrowth);let oiScore=.5;
  if(Number.isFinite(oi)&&spotReturn15m>0){if(oi>=.05)oiScore=1;else if(oi>=.01)oiScore=.75;else if(oi<=-.05)oiScore=.1;else if(oi<-.01)oiScore=.3;}
  const funding=Number(data.fundingRate);let fundingScore=.5;
  if(Number.isFinite(funding)){if(funding>.0007)fundingScore=0;else if(funding>=-.0001&&funding<=.0003)fundingScore=1;else if(funding<=.0005)fundingScore=.7;else if(funding<-.0005)fundingScore=.3;}
  const shortGrowth=Number(data.shortLiquidationGrowth),longGrowth=Number(data.longLiquidationGrowth);let liquidationScore=.5;
  if(Number.isFinite(shortGrowth)||Number.isFinite(longGrowth)){const short=Number.isFinite(shortGrowth)?shortGrowth:0;const long=Number.isFinite(longGrowth)?longGrowth:0;if(long>=2&&long>short)liquidationScore=.05;else if(long>=1&&long>short)liquidationScore=.2;else if(short>=2&&short>long)liquidationScore=1;else if(short>0&&short>long)liquidationScore=.75;}
  const overheated=(Number.isFinite(funding)&&funding>.0007)||(Number.isFinite(longGrowth)&&longGrowth>=2);
  return {score:oiScore*.4+fundingScore*.35+liquidationScore*.25,overheated,available:true};
}

function stateOf(score,overheated){if(overheated)return "NO_CHASE";if(score>=70)return "ENTRY";if(score>=50)return "SCOUT";return "WAIT";}
function highChasePenalty(row){
  const distance=Number(row.highDistance1h);if(!Number.isFinite(distance)||distance<-.005||distance>0)return {points:0,entryBlocked:false};
  const pullbackRebreak=row.pullbackRebreak1h===true||(row.higherLow15m===true&&row.structure1h==="sideways_breakout");
  const shortPump=row.return15m>=.05&&row.turnoverGrowth15m>=1;
  if(shortPump&&!pullbackRebreak)return {points:8,entryBlocked:true};
  return {points:pullbackRebreak?1:3,entryBlocked:false};
}

function scoreCandidates(metrics,derivatives={}){
  const eligible=metrics.filter(row=>row&&row.return5m>0&&row.return15m>0&&row.return15m<0.10&&row.turnoverGrowth15m>0);if(!eligible.length)return [];
  const r5=percentileRanks(eligible,"return5m"),r15=percentileRanks(eligible,"return15m"),volume=percentileRanks(eligible,"turnoverGrowth15m");
  const obvRows=eligible.map(row=>({...row,obvDirection:Number(row.obvDirection)||0}));const obv=percentileRanks(obvRows,"obvDirection");
  return eligible.map(row=>{
    const proximity=resistanceScore(row.resistanceProximity15m),structure15=(row.higherLow15m?.6:0)+proximity*.4;
    const structure1h={sideways_breakout:1,uptrend:.7,neutral:.45,unknown:.35,downtrend:0}[row.structure1h||"unknown"]??.35;
    const spotScore=100*(r5.get(row.market)*.18+r15.get(row.market)*.17+volume.get(row.market)*.20+obv.get(row.market)*.20+structure15*.15+structure1h*.10);
    const derivative=derivativeScore(derivatives[row.market],row.return15m),prePenaltyScore=spotScore*.85+derivative.score*100*.15,chase=highChasePenalty(row);
    const score=Math.max(0,prePenaltyScore-chase.points);let state=stateOf(score,derivative.overheated);if(chase.entryBlocked&&state==="ENTRY")state="SCOUT";
    return {...row,derivativeScore:+(derivative.score*100).toFixed(2),derivativeDataAvailable:derivative.available,highChasePenalty:chase.points,highChaseRisk:chase.entryBlocked,intradayScore:+score.toFixed(2),score:+score.toFixed(2),state};
  }).sort((a,b)=>b.score-a.score||b.turnoverGrowth15m-a.turnoverGrowth15m);
}

function rsi14(days){
  const closes=(days||[]).slice().reverse().map(x=>Number(x.trade_price)).filter(Number.isFinite);if(closes.length<15)return null;
  let gain=0,loss=0;for(let i=closes.length-14;i<closes.length;i++){const d=closes[i]-closes[i-1];if(d>0)gain+=d;else loss-=d;}
  if(loss===0)return 100;const rs=(gain/14)/(loss/14);return 100-100/(1+rs);
}

function dailyIgnition(days){
  const d=(days||[]).slice();
  if(d.length<21)return {dailyIgnitionScore:50,dailyIgnitionStage:"UNKNOWN",dailyIgnitionReasons:[],dailyIgnitionAvailable:false};
  const current=Number(d[0].trade_price);if(!Number.isFinite(current)||current<=0)return {dailyIgnitionScore:50,dailyIgnitionStage:"UNKNOWN",dailyIgnitionReasons:[],dailyIgnitionAvailable:false};
  const prior20=d.slice(1,21),recent5=d.slice(0,5),prior5=d.slice(5,10);
  const avgTurnover20=mean(prior20.map(x=>x.candle_acc_trade_price));
  const recentTurnover=mean(d.slice(0,3).map(x=>x.candle_acc_trade_price));
  const turnoverRatio=avgTurnover20>0?recentTurnover/avgTurnover20:null;
  const recentLow=Math.min(...recent5.map(x=>price(x,"low_price")));
  const priorLow=Math.min(...prior5.map(x=>price(x,"low_price")));
  const higherLow=Number.isFinite(recentLow)&&Number.isFinite(priorLow)&&recentLow>priorLow;
  const resistance=Math.max(...prior20.map(x=>price(x,"high_price")));
  const resistanceDistance=resistance>0?current/resistance-1:null;
  const rsi=rsi14(d);
  const close5=mean(d.slice(0,5).map(x=>x.trade_price));
  const close20=mean(d.slice(0,20).map(x=>x.trade_price));
  const maRecovery=Number.isFinite(close5)&&Number.isFinite(close20)&&current>=close5&&close5>=close20*.985;
  const range7High=Math.max(...d.slice(0,7).map(x=>price(x,"high_price"))),range7Low=Math.min(...d.slice(0,7).map(x=>price(x,"low_price")));
  const range20High=Math.max(...d.slice(1,21).map(x=>price(x,"high_price"))),range20Low=Math.min(...d.slice(1,21).map(x=>price(x,"low_price")));
  const range7=current>0?(range7High-range7Low)/current:null,range20=current>0?(range20High-range20Low)/current:null;
  const compressed=Number.isFinite(range7)&&Number.isFinite(range20)&&range20>0&&range7/range20<=.55;
  const obv=calculateObvDirection(d);
  let score=0;const reasons=[];
  if(Number.isFinite(turnoverRatio)){if(turnoverRatio>=1.6&&turnoverRatio<=3.5){score+=22;reasons.push(`D turnover x${turnoverRatio.toFixed(1)}`);}else if(turnoverRatio>=1.2){score+=14;reasons.push(`D turnover x${turnoverRatio.toFixed(1)}`);}else if(turnoverRatio>=.9)score+=7;}
  if(higherLow){score+=16;reasons.push("D higher-low");}
  if(Number.isFinite(rsi)){if(rsi>=50&&rsi<=64){score+=18;reasons.push(`D RSI ${rsi.toFixed(0)}`);}else if(rsi>=45&&rsi<50){score+=12;reasons.push(`D RSI ${rsi.toFixed(0)}`);}else if(rsi>64&&rsi<70)score+=6;}
  if(maRecovery){score+=15;reasons.push("D MA recovery");}
  if(Number.isFinite(resistanceDistance)){if(resistanceDistance>=-.07&&resistanceDistance<=.015){score+=16;reasons.push(`D resistance ${(resistanceDistance*100).toFixed(1)}%`);}else if(resistanceDistance>=-.12&&resistanceDistance<-.07)score+=8;}
  if(compressed){score+=8;reasons.push("D compression");}
  if(obv>=.15){score+=5;reasons.push("D OBV up");}
  score=Math.max(0,Math.min(100,score));
  const stage=score>=75?"IGNITION":score>=60?"PRE_IGNITION":score>=45?"ACCUMULATION":"WAIT";
  return {dailyIgnitionScore:+score.toFixed(2),dailyIgnitionStage:stage,dailyIgnitionReasons:reasons.slice(0,6),dailyIgnitionAvailable:true,dailyTurnoverRatio:Number.isFinite(turnoverRatio)?+turnoverRatio.toFixed(2):null,dailyResistanceDistance:Number.isFinite(resistanceDistance)?+resistanceDistance.toFixed(4):null,dailyRsi:Number.isFinite(rsi)?+rsi.toFixed(2):null,dailyHigherLow:higherLow,dailyCompression:compressed,dailyObvDirection:+obv.toFixed(3)};
}

function latePumpRisk(days){
  const d=(days||[]).slice();if(d.length<8)return {latePumpRisk:false,latePumpPenalty:0,latePumpReasons:[]};
  const p0=Number(d[0].trade_price),p3=Number(d[Math.min(3,d.length-1)].trade_price),p7=Number(d[Math.min(7,d.length-1)].trade_price);
  const return3d=p3>0?p0/p3-1:null,return7d=p7>0?p0/p7-1:null;
  const recentVol=d.slice(0,3).reduce((s,x)=>s+(Number(x.candle_acc_trade_price)||0),0)/3;
  const prior=d.slice(3,10),priorVol=prior.length?prior.reduce((s,x)=>s+(Number(x.candle_acc_trade_price)||0),0)/prior.length:0;
  const volumeRatio3d=priorVol>0?recentVol/priorVol:null,rsi=rsi14(d);let penalty=0;const reasons=[];
  if(Number.isFinite(return3d)&&return3d>=.25){penalty+=24;reasons.push(`3d +${(return3d*100).toFixed(0)}%`);}else if(Number.isFinite(return3d)&&return3d>=.15){penalty+=14;reasons.push(`3d +${(return3d*100).toFixed(0)}%`);}
  if(Number.isFinite(return7d)&&return7d>=.45){penalty+=16;reasons.push(`7d +${(return7d*100).toFixed(0)}%`);}
  if(Number.isFinite(rsi)&&rsi>=75){penalty+=18;reasons.push(`RSI ${rsi.toFixed(0)}`);}else if(Number.isFinite(rsi)&&rsi>=68){penalty+=8;reasons.push(`RSI ${rsi.toFixed(0)}`);}
  if(Number.isFinite(volumeRatio3d)&&volumeRatio3d>=3){penalty+=10;reasons.push(`3d volume x${volumeRatio3d.toFixed(1)}`);}
  const blocked=(Number.isFinite(return3d)&&return3d>=.20)||(Number.isFinite(rsi)&&rsi>=75)||penalty>=24;
  return {latePumpRisk:blocked,latePumpPenalty:penalty,latePumpReasons:reasons,return3d,return7d,rsi14:rsi,volumeRatio3d};
}

async function enrichLatePumpRisk(rows,{fetchImpl=fetch,limit=DAILY_RISK_TOP_N}={}){
  const targets=rows.slice(0,limit);
  const results=await Promise.allSettled(targets.map(async row=>{
    const days=await fetchJson(`${UPBIT_BASE}/v1/candles/days?market=${encodeURIComponent(row.market)}&count=${DAILY_RISK_COUNT}`,{fetchImpl});
    const risk=latePumpRisk(days),ignition=dailyIgnition(days);
    const baseAfterLate=Math.max(0,row.score-risk.latePumpPenalty);
    const score=ignition.dailyIgnitionAvailable?baseAfterLate*.75+ignition.dailyIgnitionScore*.25:baseAfterLate;
    let state=row.state;
    if(risk.latePumpRisk&&state==="ENTRY")state="NO_CHASE";
    else if(ignition.dailyIgnitionAvailable&&ignition.dailyIgnitionScore<45&&state==="ENTRY")state="SCOUT";
    else if(score<70&&state==="ENTRY")state="SCOUT";
    return {...row,...risk,...ignition,score:+score.toFixed(2),state};
  }));
  const byMarket=new Map();for(const result of results)if(result.status==="fulfilled")byMarket.set(result.value.market,result.value);
  return rows.map(row=>byMarket.get(row.market)||row).sort((a,b)=>b.score-a.score||b.turnoverGrowth15m-a.turnoverGrowth15m);
}

function rankCandidates(metrics,limit=3,derivatives={}){return scoreCandidates(metrics,derivatives).filter(row=>row.score>=50&&(row.state==="SCOUT"||row.state==="ENTRY")).slice(0,limit);}
function resistanceScore(proximity){if(!Number.isFinite(proximity))return .25;if(proximity>=-.03&&proximity<=.01)return 1;if(proximity>-.08&&proximity<-.03)return .6;if(proximity>.01&&proximity<=.03)return .4;return 0;}

async function scanPrePump({fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),batchSize=BATCH_SIZE,batchDelayMs=BATCH_DELAY_MS,derivatives={}}={}){
  const markets=await fetchJson(`${UPBIT_BASE}/v1/market/all?isDetails=false`,{fetchImpl});
  const krwMarkets=(markets||[]).map(row=>row.market).filter(market=>market?.startsWith("KRW-")).sort();const metrics=[];
  for(let index=0;index<krwMarkets.length;index+=batchSize){const batch=krwMarkets.slice(index,index+batchSize);const results=await Promise.allSettled(batch.map(async market=>{const url=`${UPBIT_BASE}/v1/candles/minutes/1?market=${encodeURIComponent(market)}&count=${CANDLES_PER_MARKET}`;return calculateMetrics(market,await fetchJson(url,{fetchImpl}));}));for(const result of results)if(result.status==="fulfilled"&&result.value)metrics.push(result.value);if(index+batchSize<krwMarkets.length)await sleep(batchDelayMs);}
  const enriched=await enrichLatePumpRisk(scoreCandidates(metrics,derivatives),{fetchImpl});
  return enriched.filter(row=>row.score>=50&&(row.state==="SCOUT"||row.state==="ENTRY")&&(!row.dailyIgnitionAvailable||row.dailyIgnitionScore>=45)).slice(0,3);
}

module.exports={calculate15mStructure,calculateMetrics,calculateObvDirection,classify1hStructure,dailyIgnition,derivativeScore,enrichLatePumpRisk,fetchJson,highChasePenalty,highDistance1h,latePumpRisk,rankCandidates,resistanceScore,rsi14,scanPrePump,scoreCandidates,stateOf,sumTurnover};
