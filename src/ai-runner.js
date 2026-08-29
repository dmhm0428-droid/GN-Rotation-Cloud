"use strict";

const {createClient}=require("@supabase/supabase-js");
const {loadAiConfig}=require("./ai/config");
const {analyzeSnapshot}=require("./ai/analyzer");
const {storeAnalyses}=require("./ai/store");
const {buildConsensus,storeConsensus}=require("./ai/consensus");

function explicitTrue(v){return /^(1|true|yes|on)$/i.test(String(v??""));}

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
  if(!run?.id)return {run:null,rows:[],watchlist:[],actionable_top_count:0};
  const {data}=await db.from("gn_pre_pump_snapshots").select("*").eq("run_id",run.id).order("rank",{ascending:true}).limit(15);
  const all=data||[];
  const rows=all.filter(r=>Number(r.rank)>=1&&Number(r.rank)<=3&&Number(r.score)>=50&&["SCOUT","ENTRY"].includes(String(r.status)));
  const watchlist=all.filter(r=>Number(r.rank)>=20).slice(0,5);
  return {run,rows,watchlist,actionable_top_count:rows.length};
}
async function buildEvidenceBundle(db){
  const [market,macro,assets,sectors,reps,crypto,onchain]=await Promise.all([
    latestOne(db,"gn_market_snapshots"),
    latestOne(db,"gn_macro_regime"),
    latestBatch(db,"gn_asset_flow_scores",8),
    latestBatch(db,"gn_sector_flow_scores",16),
    latestBatch(db,"gn_representatives",32),
    latestCrypto(db),
    latestBatch(db,"gn_latest_onchain_scores",32)
  ]);
  if(!market)throw new Error("No market snapshot available");
  const optional={
    policy_score:{available:macro?.policy_score!=null,required_only_when:"an active policy/event claim is being used as a catalyst or risk override"},
    credit_score:{available:macro?.credit_score!=null,required_only_when:"the conclusion depends on credit stress/easing"},
    institutional_flow:{available:assets.some(x=>x?.institutional_flow!=null)||sectors.some(x=>x?.institutional_flow!=null),required_only_when:"a conclusion explicitly claims institutional buying/selling"},
    onchain:{available_symbols:onchain.filter(x=>Number(x?.provider_count)>0).map(x=>x.symbol),policy:"unsupported symbols are UNAVAILABLE_NEUTRAL and must not be treated as zero/negative evidence"}
  };
  return {
    gn_contract:{
      mode:"MONEY_FOOTPRINT_FIVE_AI_PRECHECK",
      requirement:"All five providers must independently review the current evidence bundle. No dashboard VERIFIED/ENTRY status is allowed unless the five-AI consensus gate is VERIFIED.",
      review_order:["macro_policy","rates_fx_liquidity","asset_class_flow","sector_flow","institutional_spot","crypto_cex_dex_onchain","price_structure","candidate_sanity"],
      actionable_top3_rule:"Only score>=50 AND status SCOUT/ENTRY with rank 1..3 are actionable TOP3. DETECTED/NO_CHASE are watchlist only and must not expose an entry plan.",
      optional_evidence_policy:"Null optional fields are explicit coverage gaps, not contradictory data. They become blocking only when a conclusion materially relies on that axis. Never infer a missing value."
    },
    observed_at:new Date().toISOString(),
    evidence_coverage:{optional},
    market,
    macro,
    asset_flows:assets,
    sector_flows:sectors,
    representatives:reps,
    onchain,
    crypto
  };
}

async function main(){
  // Emergency cost kill switch: paid AI traffic is OFF unless this separate flag is explicitly true.
  // AI_ANALYSIS_ENABLED alone is no longer sufficient to send any provider request.
  if(!explicitTrue(process.env.AI_PAID_REQUESTS_ENABLED)){
    console.log("Paid AI requests are disabled by AI_PAID_REQUESTS_ENABLED kill switch; no provider requests were sent.");
    return;
  }
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
