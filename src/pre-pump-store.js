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
      benchmark_independence:{
        class:candidate.dependencyClass??"UNKNOWN",
        independent:candidate.btcEthIndependent===true,
        benchmark_available:candidate.benchmarkAvailable===true,
        score:candidate.independenceScore??null,
        same_day_activation_score:candidate.sameDayActivationScore??null,
        same_day_ready:candidate.sameDayReady===true,
        return60m:candidate.return60m??null,
        relative_5m_vs_btc:candidate.relative5mVsBtc??null,
        relative_5m_vs_eth:candidate.relative5mVsEth??null,
        relative_15m_vs_btc:candidate.relative15mVsBtc??null,
        relative_15m_vs_eth:candidate.relative15mVsEth??null,
        relative_60m_vs_btc:candidate.relative60mVsBtc??null,
        relative_60m_vs_eth:candidate.relative60mVsEth??null,
        btc_return_15m:candidate.benchmarkBtcReturn15m??null,
        eth_return_15m:candidate.benchmarkEthReturn15m??null,
        btc_return_60m:candidate.benchmarkBtcReturn60m??null,
        eth_return_60m:candidate.benchmarkEthReturn60m??null,
        execution_priority:candidate.executionPriority??null,
        entry_slot:candidate.entrySlot??null,
        activation_window:candidate.activationWindow??"1-6H",
        holding_horizon:candidate.holdingHorizon??"INTRADAY_1D",
        same_day_exit_required:candidate.sameDayExitRequired!==false
      },
      obv:{direction:candidate.obvDirection??null},
      structure:{higher_low_15m:candidate.higherLow15m??null,resistance_proximity_15m:candidate.resistanceProximity15m??null,structure_1h:candidate.structure1h??null},
      derivatives:{score:candidate.derivativeScore??50,data_available:candidate.derivativeDataAvailable??false},
      new_listing:{
        is_new:candidate.newListing??false,
        age_days:candidate.newListingAgeDays??null,
        history_days:candidate.newListingHistoryDays??null,
        overseas_available:candidate.overseasAvailable??false,
        source:candidate.overseasSource??null,
        overseas_listing_usd:candidate.overseasListingUsd??null,
        overseas_current_usd:candidate.overseasCurrentUsd??null,
        overseas_listing_time:candidate.overseasListingTime??null,
        return_from_overseas_listing:candidate.overseasReturnFromListing??null,
        upbit_premium_vs_overseas:candidate.upbitPremiumVsOverseas??null,
        usdt_krw:candidate.overseasUsdtKrw??null,
        score_delta:candidate.overseasScoreDelta??0,
        reasons:candidate.overseasReasons||[]
      },
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
