"use strict";

const {createClient}=require("@supabase/supabase-js");
const {loadAiConfig}=require("./ai/config");
const {analyzeSnapshot}=require("./ai/analyzer");
const {storeAnalyses}=require("./ai/store");
const {buildConsensus,storeConsensus}=require("./ai/consensus");

async function latestOne(db,table){
  const {data,error}=await db.from(table).select("*").order("ts",{ascending:false}).limit(1).maybeSingle();
  if(error)return null;
  return data||null;
}
async function latestBatch(db,table,limit=12){
  const {data:head,error}=await db.from(table).select("ts").order("ts",{ascending:false}).limit(1).maybeSingle();
  if(error||!head?.ts)return [];
  const {data}=await db.from(table).select("*").eq("ts",head.ts).limit(limit);
  return data||[];
}
async function latestCrypto(db){
  const {data:runs}=await db.from("gn_runs").select("id,started_at,status,source_status").order("started_at",{ascending:false}).limit(60);
  const run=(runs||[]).find(r=>String(r?.source_status?.source||"").includes("pre_pump_scanner"))||null;
  if(!run?.id)return {run:null,rows:[]};
  const {data}=await db.from("gn_pre_pump_snapshots").select("*").eq("run_id",run.id).order("rank",{ascending:true}).limit(3);
  return {run,rows:data||[]};
}
async function buildEvidenceBundle(db){
  const [market,macro,assets,sectors,reps,crypto]=await Promise.all([
    latestOne(db,"gn_market_snapshots"),
    latestOne(db,"gn_macro_regime"),
    latestBatch(db,"gn_asset_flow_scores",8),
    latestBatch(db,"gn_sector_flow_scores",16),
    latestBatch(db,"gn_representatives",32),
    latestCrypto(db)
  ]);
  if(!market)throw new Error("No market snapshot available");
  return {
    gn_contract:{
      mode:"MONEY_FOOTPRINT_FIVE_AI_PRECHECK",
      requirement:"All five providers must independently review the current evidence bundle. No dashboard VERIFIED/ENTRY status is allowed unless the five-AI consensus gate is VERIFIED.",
      review_order:["macro_policy","rates_fx_liquidity","asset_class_flow","sector_flow","institutional_spot","crypto_cex_dex_onchain","price_structure","candidate_sanity"]
    },
    observed_at:new Date().toISOString(),
    market,
    macro,
    asset_flows:assets,
    sector_flows:sectors,
    representatives:reps,
    crypto
  };
}

async function main(){
  const config=loadAiConfig();
  if(!config.enabled){console.log("AI analysis is disabled; no provider requests were sent.");return;}
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("Supabase env vars missing");
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const evidence=await buildEvidenceBundle(db);
  const sourceTs=evidence.market.ts;
  const results=await analyzeSnapshot(evidence,config);
  await storeAnalyses(db,results,sourceTs);
  const consensus=buildConsensus(results,sourceTs);
  const stored=await storeConsensus(db,consensus);
  console.log(JSON.stringify({ok:true,consensus:stored,results:results.map(r=>({provider:r.provider,status:r.status,errorCode:r.errorCode||null}))}));
}

if(require.main===module)main().catch(error=>{console.error(error?.code||error?.name||"AI_RUN_ERROR");process.exitCode=1;});
module.exports={main,buildEvidenceBundle};
