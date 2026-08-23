"use strict";

const TOP3_MIN_SCORE=58;
const TOP3_MAX_RETURN_5M=.035;
const TOP3_MAX_RETURN_15M=.06;
const TOP3_MIN_DAILY_IGNITION=45;
const TOP3_STATUSES=new Set(["SCOUT","ENTRY"]);

function isLatePump(details){
  const late=details?.late_pump;
  if(!late)return false;
  return late.latePumpRisk===true||late.risk===true||late.blocked===true||late.no_chase===true;
}

function isDisplayableTopCandidate(row){
  if(!row||Number(row.rank)>=100)return false;
  if(!TOP3_STATUSES.has(String(row.status||"").toUpperCase()))return false;
  const score=Number(row.score),r5=Number(row.return5m),r15=Number(row.return15m);
  if(!Number.isFinite(score)||score<TOP3_MIN_SCORE)return false;
  if(!Number.isFinite(r5)||r5<=0||r5>TOP3_MAX_RETURN_5M)return false;
  if(!Number.isFinite(r15)||r15<=0||r15>TOP3_MAX_RETURN_15M)return false;
  const daily=row.details?.daily_ignition;
  if(daily?.available===true&&Number(daily.score)<TOP3_MIN_DAILY_IGNITION)return false;
  if(row.details?.market_block)return false;
  if(row.details?.market_context?.warOverride===true)return false;
  if(isLatePump(row.details))return false;
  return true;
}

function formatCandidate(row){
  const holding=Number(row.rank)>=100||["HOLD","REDUCE","EXIT"].includes(row.status);
  const context=row.details?.market_context||null;
  const sizing=row.details?.shannon_thorp||null;
  const daily=row.details?.daily_ignition||null;
  return {
    rank:holding?"보유":row.rank,
    market:row.market,
    score:row.score,
    status:row.status,
    holding,
    return5m:row.return5m,
    return15m:row.return15m,
    volumeRatio15m:row.volume_ratio15m,
    reason:row.details?.holding_reason||row.details?.confirmation?.reason||row.details?.market_block||null,
    latePump:row.details?.late_pump||null,
    dailyIgnition:daily?{
      score:daily.score,
      stage:daily.stage,
      available:daily.available,
      reasons:daily.reasons||[],
      turnoverRatio:daily.turnover_ratio,
      resistanceDistance:daily.resistance_distance,
      rsi:daily.rsi,
      higherLow:daily.higher_low,
      compression:daily.compression,
      obvDirection:daily.obv_direction,
      intradayScore:daily.intraday_score
    }:null,
    marketContext:context?{
      marketScore:context.marketScore,
      gateScore:context.gateScore,
      regime:context.regime,
      breadth:context.breadth,
      policyScore:context.policyScore,
      aiBias:context.aiBias,
      warOverride:context.warOverride
    }:null,
    shannonThorp:sizing?{
      support:sizing.support,
      shannonQuality:sizing.shannonQuality,
      estimatedWinP:sizing.estimatedWinP,
      referencePositionPct:sizing.referencePositionPct
    }:null,
    updated_at:row.ts
  };
}

async function loadLatestPrePump(db){
  const latest=await db.from("gn_pre_pump_snapshots")
    .select("run_id,ts")
    .order("ts",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(latest.error)throw latest.error;
  if(!latest.data)return [];

  const rows=await db.from("gn_pre_pump_snapshots")
    .select("rank,market,score,status,return5m,return15m,volume_ratio15m,details,ts")
    .eq("run_id",latest.data.run_id)
    .order("rank",{ascending:true})
    .limit(13);
  if(rows.error)throw rows.error;

  const source=rows.data||[];
  const top=source
    .filter(isDisplayableTopCandidate)
    .sort((a,b)=>Number(b.score)-Number(a.score)||Number(a.rank)-Number(b.rank))
    .slice(0,3)
    .map((row,index)=>formatCandidate({...row,rank:index+1}));

  // 보유 추적은 TOP3 선발과 분리한다. TOP3가 비면 억지로 3개를 채우지 않는다.
  const holdings=source.filter(row=>Number(row.rank)>=100||["HOLD","REDUCE","EXIT"].includes(row.status)).map(formatCandidate);
  return [...top,...holdings];
}

function createLatestPrePumpHandler({db,load=loadLatestPrePump}){
  return async function latestPrePumpHandler(req,res){
    try{return res.json(await load(db));}
    catch(error){return res.status(500).json({error:error?.message||"Failed to load scanner data"});}
  };
}

module.exports={createLatestPrePumpHandler,formatCandidate,isDisplayableTopCandidate,loadLatestPrePump};
