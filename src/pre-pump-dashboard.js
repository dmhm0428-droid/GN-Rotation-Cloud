"use strict";

function formatCandidate(row){
  return {
    rank:row.rank,
    market:row.market,
    score:row.score,
    status:row.status,
    return5m:row.return5m,
    return15m:row.return15m,
    volumeRatio15m:row.volume_ratio15m,
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
    .select("rank,market,score,status,return5m,return15m,volume_ratio15m,ts")
    .eq("run_id",latest.data.run_id)
    .order("rank",{ascending:true})
    .limit(3);
  if(rows.error)throw rows.error;
  return (rows.data||[]).map(formatCandidate);
}

function createLatestPrePumpHandler({db,load=loadLatestPrePump}){
  return async function latestPrePumpHandler(req,res){
    try{return res.json(await load(db));}
    catch(error){return res.status(500).json({error:error?.message||"Failed to load scanner data"});}
  };
}

module.exports={createLatestPrePumpHandler,formatCandidate,loadLatestPrePump};
