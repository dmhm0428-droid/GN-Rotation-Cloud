"use strict";

const {createClient}=require("@supabase/supabase-js");
const {loadAiConfig}=require("./ai/config");
const {analyzeSnapshot}=require("./ai/analyzer");
const {storeAnalyses}=require("./ai/store");

async function main(){
  const config=loadAiConfig();
  if(!config.enabled){console.log("AI analysis is disabled; no provider requests were sent.");return;}
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("Supabase env vars missing");
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.from("gn_market_snapshots").select("ts,market_score,action,regime,quality,spot_breadth100,funding_hot,btc_taker_ratio,eth_taker_ratio,reasons,components").order("ts",{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;if(!data)throw new Error("No market snapshot available");
  const results=await analyzeSnapshot(data,config);await storeAnalyses(db,results,data.ts);
  console.log(JSON.stringify({ok:true,results:results.map(r=>({provider:r.provider,status:r.status,errorCode:r.errorCode||null}))}));
}

if(require.main===module)main().catch(error=>{console.error(error?.code||error?.name||"AI_RUN_ERROR");process.exitCode=1;});
module.exports={main};
