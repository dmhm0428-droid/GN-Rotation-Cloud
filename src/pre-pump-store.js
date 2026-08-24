"use strict";

function createRepository(db){
  return {
    async start(startedAt){
      const {data,error}=await db.from("gn_runs").insert({started_at:startedAt,status:"running",source_status:{source:"pre_pump_scanner"}}).select("id").single();
      if(error)throw error;
      return data.id;
    },
    async insertCandidates(rows){
      if(!rows.length)return;
      const {error}=await db.from("gn_pre_pump_snapshots").insert(rows);
      if(error)throw error;
    },
    async finish(runId,status,finishedAt){
      const {error}=await db.from("gn_runs").update({finished_at:finishedAt,status,source_status:{source:"pre_pump_scanner",candidate_count:status==="success"?undefined:0}}).eq("id",runId);
      if(error)throw error;
    }
  };
}

function snapshotRows(candidates,runId,timestamp){
  return candidates.slice(0,3).map((candidate,index)=>({
    run_id:runId,
    ts:timestamp,
    market:candidate.market,
    rank:index+1,
    score:candidate.score,
    status:candidate.state,
    krw_price:candidate.krwPrice??null,
    return5m:candidate.return5m,
    return15m:candidate.return15m,
    volume_ratio15m:candidate.turnoverGrowth15m,
    details:{
      obv:{direction:candidate.obvDirection??null},
      structure:{higher_low_15m:candidate.higherLow15m??null,resistance_proximity_15m:candidate.resistanceProximity15m??null,structure_1h:candidate.structure1h??null},
      derivatives:{score:candidate.derivativeScore??50,data_available:candidate.derivativeDataAvailable??false},
      orderbook:{
        available:candidate.orderbookAvailable??false,
        signal:candidate.orderbookSignal??"UNKNOWN",
        score_delta:candidate.orderbookScoreDelta??0,
        entry_blocked:candidate.orderbookEntryBlocked??false,
        bid_imbalance:candidate.orderbookBidImbalance??null,
        ask_wall_ratio:candidate.orderbookAskWallRatio??null,
        bid_wall_ratio:candidate.orderbookBidWallRatio??null,
        ask_wall_depletion:candidate.orderbookAskWallDepletion??null,
        best_bid_held:candidate.orderbookBestBidHeld??null,
        best_ask_lifted:candidate.orderbookBestAskLifted??null,
        bid_depth_held:candidate.orderbookBidDepthHeld??null,
        ask_depth_falling:candidate.orderbookAskDepthFalling??null,
        best_bid:candidate.orderbookBestBid??null,
        best_ask:candidate.orderbookBestAsk??null,
        ask_wall_price:candidate.orderbookAskWallPrice??null,
        bid_wall_price:candidate.orderbookBidWallPrice??null
      },
      daily_ignition:{
        score:candidate.dailyIgnitionScore??null,
        stage:candidate.dailyIgnitionStage??null,
        available:candidate.dailyIgnitionAvailable??false,
        reasons:candidate.dailyIgnitionReasons||[],
        turnover_ratio:candidate.dailyTurnoverRatio??null,
        resistance_distance:candidate.dailyResistanceDistance??null,
        rsi:candidate.dailyRsi??null,
        higher_low:candidate.dailyHigherLow??null,
        compression:candidate.dailyCompression??null,
        obv_direction:candidate.dailyObvDirection??null,
        intraday_score:candidate.intradayScore??null
      },
      late_pump:{risk:candidate.latePumpRisk??false,penalty:candidate.latePumpPenalty??0,reasons:candidate.latePumpReasons||[]}
    }
  }));
}

function databaseFromEnvironment(env=process.env,createClientImpl){
  const url=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return null;
  const createClient=createClientImpl||require("@supabase/supabase-js").createClient;
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

async function savePrePumpScan({candidates,env=process.env,db,repository,now=()=>new Date().toISOString()}={}){
  const activeDb=db||(!repository&&databaseFromEnvironment(env));
  if(!repository&&!activeDb)return {stored:false,skipped:true,cause:"missing_supabase_environment"};
  const repo=repository||createRepository(activeDb);
  const startedAt=now();
  let runId=null;
  try{
    runId=await repo.start(startedAt);
    await repo.insertCandidates(snapshotRows(candidates||[],runId,startedAt));
    await repo.finish(runId,"success",now());
    return {stored:true,skipped:false,runId};
  }catch{
    if(runId){try{await repo.finish(runId,"error",now());}catch{}}
    return {stored:false,skipped:false,cause:"database_save_failed"};
  }
}

module.exports={createRepository,databaseFromEnvironment,savePrePumpScan,snapshotRows};
