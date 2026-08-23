"use strict";

const TOP3_MIN_SCORE=58;
const TOP3_MAX_RETURN_5M=.035;
const TOP3_MAX_RETURN_15M=.06;
const TOP3_MIN_DAILY_IGNITION=45;
const TOP3_STATUSES=new Set(["SCOUT","ENTRY","CONFIRM_WAIT"]);
const TRACK_LIMIT=180;
const TRACK_HOURS=8;

function num(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function minutesBetween(a,b){const x=new Date(a).getTime(),y=new Date(b).getTime();return Number.isFinite(x)&&Number.isFinite(y)?Math.max(0,(x-y)/60000):null;}
function isLatePump(details){
  const late=details?.late_pump;
  if(!late)return false;
  return late.latePumpRisk===true||late.risk===true||late.blocked===true||late.no_chase===true;
}
function marketScoreOf(row){return num(row?.details?.market_context?.marketScore);}

function isDisplayableTopCandidate(row){
  if(!row||Number(row.rank)>=100)return false;
  if(!TOP3_STATUSES.has(String(row.status||"").toUpperCase()))return false;
  const score=num(row.score),r5=num(row.return5m),r15=num(row.return15m);
  if(score==null||score<TOP3_MIN_SCORE)return false;
  if(r5==null||r5<=0||r5>TOP3_MAX_RETURN_5M)return false;
  if(r15==null||r15<=0||r15>TOP3_MAX_RETURN_15M)return false;
  const daily=row.details?.daily_ignition;
  if(daily?.available===true&&Number(daily.score)<TOP3_MIN_DAILY_IGNITION)return false;
  if(row.details?.market_block)return false;
  if(row.details?.market_context?.warOverride===true)return false;
  if(isLatePump(row.details))return false;
  return true;
}

function priceChangePct(entryPrice,currentPrice){
  const a=num(entryPrice),b=num(currentPrice);
  return a&&b?((b/a)-1)*100:null;
}

function classifyAction({row,previous,firstSignal,peakScore,marketScore,marketDelta,inLatest,latestTs}){
  const score=num(row?.score)??0;
  const previousScore=num(previous?.score);
  const pumpDelta=previousScore==null?null:score-previousScore;
  const status=String(row?.status||"").toUpperCase();
  const r15=num(row?.return15m)??0;
  const currentPrice=num(row?.krw_price);
  const signalPrice=num(firstSignal?.krw_price);
  const gain=priceChangePct(signalPrice,currentPrice);
  const ageMinutes=minutesBetween(latestTs,row?.ts);
  const disappeared=!inLatest&&ageMinutes!=null&&ageMinutes>=20;
  const late=isLatePump(row?.details)||status==="NO_CHASE";
  const marketUp=(marketDelta??0)>=2;
  const pumpFalling=(pumpDelta??0)<=-8;
  const pumpStalled=(pumpDelta??0)<=1;
  const peakDrop=num(peakScore)==null?0:num(peakScore)-score;

  if(late){
    return {action:firstSignal?"매도준비":"추격금지",tone:"bad",reason:firstSignal?"과열/NO_CHASE 전환 · 보유분 익절 우선":"과열 구간 · 신규진입 금지",pumpDelta,gain,ageMinutes};
  }
  if(firstSignal&&marketUp&&(pumpFalling||peakDrop>=15)){
    return {action:"매도준비",tone:"warn",reason:"시장점수는 개선되는데 종목 펌프점수 약화",pumpDelta,gain,ageMinutes};
  }
  if(firstSignal&&disappeared&&marketUp&&pumpStalled){
    return {action:"매도준비",tone:"warn",reason:"시장 강세인데 재추천이 끊겨 상대강도 둔화",pumpDelta,gain,ageMinutes};
  }
  if(firstSignal&&disappeared){
    return {action:"보유점검",tone:"warn",reason:"TOP3 이탈 · 다음 스캔까지 가격/점수 재확인",pumpDelta,gain,ageMinutes};
  }
  if(firstSignal&&gain!=null&&gain>=8){
    return {action:"매도준비",tone:"warn",reason:"추천가 대비 +8% 이상 · 익절매물 경계",pumpDelta,gain,ageMinutes};
  }
  if(inLatest&&marketScore!=null&&marketScore>=55&&marketScore<=69&&score>=68&&score<=82&&r15<=.03&&(gain==null||gain<=3)){
    return {action:firstSignal&&firstSignal!==row?"보유":"진입",tone:"good",reason:"시장 55~69 상승구간 + 펌프 68~82 + 가격 과열 전",pumpDelta,gain,ageMinutes};
  }
  if(inLatest&&score>=70&&marketScore!=null&&marketScore>=60){
    if(gain!=null&&gain>=5)return {action:"보유",tone:"blue",reason:"강도 확인됐지만 신규진입은 늦음",pumpDelta,gain,ageMinutes};
    return {action:firstSignal?"보유":"진입대기",tone:"blue",reason:"종목 강도 유지 · 가격 위치 확인",pumpDelta,gain,ageMinutes};
  }
  return {action:firstSignal?"보유점검":"진입대기",tone:"muted",reason:firstSignal?"추천 이력 유지 · 다음 스캔 확인":"조건 일부 미충족",pumpDelta,gain,ageMinutes};
}

function formatCandidate(row,extra={}){
  const holding=Number(row.rank)>=100||["HOLD","REDUCE","EXIT"].includes(row.status);
  const context=row.details?.market_context||null;
  const sizing=row.details?.shannon_thorp||null;
  const daily=row.details?.daily_ignition||null;
  return {
    rank:extra.rank??(holding?"보유":row.rank),
    market:row.market,
    score:row.score,
    scannerStatus:row.status,
    status:extra.action||row.status,
    action:extra.action||null,
    actionTone:extra.tone||null,
    actionReason:extra.reason||null,
    holding,
    inLatest:extra.inLatest??true,
    return5m:row.return5m,
    return15m:row.return15m,
    volumeRatio15m:row.volume_ratio15m,
    krwPrice:row.krw_price??null,
    signalPrice:extra.firstSignal?.krw_price??null,
    signalScore:extra.firstSignal?.score??null,
    peakScore:extra.peakScore??row.score,
    pumpDelta:extra.pumpDelta??null,
    marketScore:extra.marketScore??marketScoreOf(row),
    marketDelta:extra.marketDelta??null,
    gainFromSignalPct:extra.gain??null,
    ageMinutes:extra.ageMinutes??null,
    reason:row.details?.holding_reason||row.details?.confirmation?.reason||row.details?.market_block||null,
    latePump:row.details?.late_pump||null,
    dailyIgnition:daily?{
      score:daily.score,stage:daily.stage,available:daily.available,reasons:daily.reasons||[],turnoverRatio:daily.turnover_ratio,resistanceDistance:daily.resistance_distance,rsi:daily.rsi,higherLow:daily.higher_low,compression:daily.compression,obvDirection:daily.obv_direction,intradayScore:daily.intraday_score
    }:null,
    marketContext:context?{marketScore:context.marketScore,gateScore:context.gateScore,regime:context.regime,breadth:context.breadth,policyScore:context.policyScore,aiBias:context.aiBias,warOverride:context.warOverride}:null,
    shannonThorp:sizing?{support:sizing.support,shannonQuality:sizing.shannonQuality,estimatedWinP:sizing.estimatedWinP,referencePositionPct:sizing.referencePositionPct}:null,
    updated_at:row.ts
  };
}

async function readRecentHistory(db){
  try{
    const q=await db.from("gn_pre_pump_snapshots").select("run_id,rank,market,score,status,return5m,return15m,volume_ratio15m,krw_price,details,ts").order("ts",{ascending:false}).limit(TRACK_LIMIT);
    return q.error?[]:(q.data||[]);
  }catch{return [];}
}
async function readMarketTrend(db){
  try{
    const q=await db.from("gn_market_snapshots").select("ts,market_score,action,regime").order("ts",{ascending:false}).limit(4);
    const rows=q.error?[]:(q.data||[]);
    const latest=num(rows[0]?.market_score),oldest=num(rows.at(-1)?.market_score);
    return {score:latest,delta:latest!=null&&oldest!=null?latest-oldest:null};
  }catch{return {score:null,delta:null};}
}

async function loadLatestPrePump(db){
  const latest=await db.from("gn_pre_pump_snapshots").select("run_id,ts").order("ts",{ascending:false}).limit(1).maybeSingle();
  if(latest.error)throw latest.error;
  if(!latest.data)return [];

  const rows=await db.from("gn_pre_pump_snapshots").select("rank,market,score,status,return5m,return15m,volume_ratio15m,krw_price,details,ts").eq("run_id",latest.data.run_id).order("rank",{ascending:true}).limit(20);
  if(rows.error)throw rows.error;

  const [history,marketTrend]=await Promise.all([readRecentHistory(db),readMarketTrend(db)]);
  const source=rows.data||[];
  const latestMarkets=new Set(source.map(r=>r.market));
  const cutoff=new Date(latest.data.ts).getTime()-TRACK_HOURS*3600000;
  const usableHistory=(history.length?history:source).filter(r=>new Date(r.ts).getTime()>=cutoff);
  const byMarket=new Map();
  for(const r of usableHistory){if(!byMarket.has(r.market))byMarket.set(r.market,[]);byMarket.get(r.market).push(r);}
  for(const arr of byMarket.values())arr.sort((a,b)=>new Date(b.ts)-new Date(a.ts));

  const top=source.filter(isDisplayableTopCandidate).sort((a,b)=>Number(b.score)-Number(a.score)||Number(a.rank)-Number(b.rank)).slice(0,3);
  const trackedMarkets=new Set(top.map(r=>r.market));
  for(const [market,arr] of byMarket){
    if(arr.some(r=>TOP3_STATUSES.has(String(r.status||"").toUpperCase())&&Number(r.score)>=68&&!isLatePump(r.details)))trackedMarkets.add(market);
  }

  const result=[];
  for(const market of trackedMarkets){
    const arr=byMarket.get(market)||[];
    const row=(source.find(r=>r.market===market)||arr[0]);
    if(!row)continue;
    const chronological=arr.slice().reverse();
    const firstSignal=chronological.find(r=>TOP3_STATUSES.has(String(r.status||"").toUpperCase())&&Number(r.score)>=68&&!isLatePump(r.details))||null;
    const peakScore=arr.reduce((m,r)=>Math.max(m,Number(r.score)||0),0);
    const previous=arr.find(r=>r.ts!==row.ts)||null;
    const rowMarketScore=marketScoreOf(row);
    const marketScore=marketTrend.score??rowMarketScore;
    const marketDelta=marketTrend.delta;
    const inLatest=latestMarkets.has(market);
    const action=classifyAction({row,previous,firstSignal,peakScore,marketScore,marketDelta,inLatest,latestTs:latest.data.ts});
    const topIndex=top.findIndex(r=>r.market===market);
    result.push(formatCandidate(row,{rank:topIndex>=0?topIndex+1:"추적",firstSignal,peakScore,marketScore,marketDelta,inLatest,...action}));
  }

  const priority={"매도":0,"매도준비":1,"진입":2,"진입대기":3,"보유":4,"보유점검":5,"추격금지":6};
  return result.sort((a,b)=>(priority[a.action]??9)-(priority[b.action]??9)||(a.rank==="추적"?1:0)-(b.rank==="추적"?1:0)||Number(b.score)-Number(a.score)).slice(0,10);
}

function createLatestPrePumpHandler({db,load=loadLatestPrePump}){
  return async function latestPrePumpHandler(req,res){
    try{return res.json(await load(db));}
    catch(error){return res.status(500).json({error:error?.message||"Failed to load scanner data"});}
  };
}

module.exports={classifyAction,createLatestPrePumpHandler,formatCandidate,isDisplayableTopCandidate,loadLatestPrePump};
