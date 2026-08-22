"use strict";

const {loadAiConfig}=require("./config");
const {invokeProvider}=require("./providers");

const TEST_MARKER="ONE_TIME_DEEPSEEK_TEST";
const SNAPSHOT_COLUMNS="ts,market_score,action,regime,quality,spot_breadth100,funding_hot,btc_taker_ratio,eth_taker_ratio,reasons,components";

function enabled(value){return /^(1|true|yes|on)$/i.test(String(value||""));}
function safeCode(error){return error?.code&&/^[A-Z0-9_]+$/.test(error.code)?error.code:"AI_TEST_ERROR";}

function createRepository(db){
  return {
    async findExisting(){
      const {data,error}=await db.from("gn_ai_analyses").select("id,status").eq("provider","deepseek").eq("error_code",TEST_MARKER).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(error)throw error;
      return data||null;
    },
    async latestSnapshot(){
      const {data,error}=await db.from("gn_market_snapshots").select(SNAPSHOT_COLUMNS).order("ts",{ascending:false}).limit(1).maybeSingle();
      if(error)throw error;
      return data||null;
    },
    async reserve(snapshot,model){
      const {data,error}=await db.from("gn_ai_analyses").insert({source_snapshot_ts:snapshot.ts||null,provider:"deepseek",model,status:"skipped",signals:[],usage:{},error_code:TEST_MARKER}).select("id,status").single();
      if(error)throw error;
      return data;
    },
    async markSuccess(id,result){
      const {error}=await db.from("gn_ai_analyses").update({status:"success",summary:result.summary||null,sentiment:result.sentiment||null,confidence:Number.isFinite(result.confidence)?result.confidence:null,signals:result.signals||[],usage:result.usage||{},cost_usd:Number.isFinite(result.costUsd)?result.costUsd:null}).eq("id",id);
      if(error)throw error;
    },
    async markFailure(id){
      const {error}=await db.from("gn_ai_analyses").update({status:"error"}).eq("id",id);
      if(error)throw error;
    },
    async verify(id){
      const {data,error}=await db.from("gn_ai_analyses").select("id,status").eq("id",id).maybeSingle();
      if(error)throw error;
      return data||null;
    }
  };
}

function deepSeekOnlyConfig(env){
  return loadAiConfig({...env,AI_ANALYSIS_ENABLED:"true",PERPLEXITY_ENABLED:"false",XAI_ENABLED:"false",DEEPSEEK_ENABLED:"true"}).providers.deepseek;
}

function createDeepSeekTestHandler({db,env=process.env,repository=createRepository(db),invoke=invokeProvider}){
  let running=false;
  return async function deepSeekTest(req,res){
    if(!enabled(env.AI_TEST_ENABLED))return res.status(404).json({success:false,cause:"disabled"});
    if(running)return res.status(409).json({success:false,cause:"already_running"});
    running=true;
    let reservation=null;
    try{
      const existing=await repository.findExisting();
      if(existing)return res.status(409).json({success:false,stored:existing.status==="success",cause:"already_executed"});
      const snapshot=await repository.latestSnapshot();
      if(!snapshot)return res.status(409).json({success:false,stored:false,cause:"no_market_snapshot"});
      const provider=deepSeekOnlyConfig(env);
      reservation=await repository.reserve(snapshot,provider.model);
      const result=await invoke(provider,snapshot);
      await repository.markSuccess(reservation.id,result);
      const saved=await repository.verify(reservation.id);
      const stored=saved?.status==="success";
      return res.status(stored?200:500).json({success:stored,stored,cause:stored?"saved":"verification_failed"});
    }catch(error){
      if(reservation){try{await repository.markFailure(reservation.id);}catch{}}
      return res.status(502).json({success:false,stored:false,cause:safeCode(error)});
    }finally{running=false;}
  };
}

module.exports={TEST_MARKER,createDeepSeekTestHandler,createRepository,deepSeekOnlyConfig};
