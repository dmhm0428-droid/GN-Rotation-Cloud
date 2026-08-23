"use strict";

function formatCandidate(row){
  const holding=Number(row.rank)>=100||["HOLD","REDUCE","EXIT"].includes(row.status);
  const context=row.details?.market_context||null;
  const sizing=row.details?.shannon_thorp||null;
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

  // rank 1~3 = 신규 후보. rank 100+ = 최근 ENTRY 이후 보유 추적.
  // V5는 시장 게이트, 정책/AI 컨텍스트, Shannon-Thorp 참고 비중을 details에 함께 저장한다.
  // TOP3 이탈 자체는 매도/교체 신호로 취급하지 않는다.
  return (rows.data||[]).map(formatCandidate);
}

function createLatestPrePumpHandler({db,load=loadLatestPrePump}){
  return async function latestPrePumpHandler(req,res){
    try{return res.json(await load(db));}
    catch(error){return res.status(500).json({error:error?.message||"Failed to load scanner data"});}
  };
}

module.exports={createLatestPrePumpHandler,formatCandidate,loadLatestPrePump};
