"use strict";

const {createClient}=require("@supabase/supabase-js");
const {loadAiConfig}=require("./ai/config");
const {analyzeSnapshot}=require("./ai/analyzer");
const {storeAnalyses}=require("./ai/store");
const {buildConsensus,storeConsensus}=require("./ai/consensus");

function explicitTrue(v){return /^(1|true|yes|on)$/i.test(String(v??""));}
function dbFromEnv(env=process.env){
  const url=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("Supabase env vars missing");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function latestOne(db,table){const {data,error}=await db.from(table).select("*").order("ts",{ascending:false}).limit(1).maybeSingle();return error?null:data||null;}
async function latestBatch(db,table,limit=24){
  const {data:head,error}=await db.from(table).select("ts").order("ts",{ascending:false}).limit(1).maybeSingle();if(error||!head?.ts)return [];
  const {data}=await db.from(table).select("*").eq("ts",head.ts).limit(limit);return data||[];
}
async function latestImmediateCrypto(db){
  const {data:runs,error}=await db.from("gn_runs").select("id,started_at,status,source_status").order("started_at",{ascending:false}).limit(40);
  if(error)return {ts:null,rows:[]};
  const run=(runs||[]).find(r=>String(r?.source_status?.source||"")==="pre_pump_immediate_v2")||null;
  if(!run?.id)return {ts:null,rows:[]};
  const {data}=await db.from("gn_pre_pump_snapshots").select("*").eq("run_id",run.id).order("rank",{ascending:true}).limit(3);
  const rows=(data||[]).filter(row=>Number(row.rank)>=1&&Number(row.rank)<=3&&["SCOUT","ENTRY"].includes(String(row.status))&&row?.details?.mechanical_entry_ready===true&&Number(row.score)>=78);
  return {ts:run.started_at,runId:run.id,rows};
}
async function alreadyAudited(db,sourceTs){
  if(!sourceTs)return false;
  const {data}=await db.from("gn_ai_consensus").select("id,source_snapshot_ts,verdict,all_five_ok,providers_success,created_at").eq("source_snapshot_ts",sourceTs).order("created_at",{ascending:false}).limit(1).maybeSingle();
  return Boolean(data?.id);
}
async function buildEvidenceBundle(db,crypto){
  const [market,macro,assets,sectors,reps,onchain]=await Promise.all([
    latestOne(db,"gn_market_snapshots"),latestOne(db,"gn_macro_regime"),latestBatch(db,"gn_asset_flow_scores",8),latestBatch(db,"gn_sector_flow_scores",16),latestBatch(db,"gn_representatives",32),latestBatch(db,"gn_latest_onchain_scores",48)
  ]);
  if(!market)throw new Error("No market snapshot available");
  const proposed=crypto.rows.map(row=>({
    market:row.market,rank:row.rank,score:Number(row.score),mechanical_status:row.status,krw_price:row.krw_price,
    entry_plan:row?.details?.trade_plan||null,lead_lag:row?.details?.lead_lag||null,expansion:row?.details?.expansion||null,
    derivatives:row?.details?.derivatives||null,onchain:row?.details?.onchain||null,structure:row?.details?.structure||null,
    orderbook:row?.details?.orderbook||null,listing_risk:row?.listing_risk||null,listing_risk_reasons:row?.details?.listing_risk_reasons||[]
  }));
  return {
    gn_contract:{
      mode:"IMMEDIATE_ENTRY_FIVE_AI_GATE_V2",
      requirement:"Every row in crypto.proposed_entries already passed the deterministic immediate-entry precheck. GN_DATA_VERDICT:PASS is allowed only when ALL listed candidates remain valid to enter now inside the supplied entry range and current macro/flow evidence is fresh and coherent. If any row is stale, extended, contradicted, or the entry range is no longer sane, return PARTIAL or FAIL.",
      review_order:["macro_policy","rates_fx_liquidity","asset_class_flow","sector_flow","institutional_spot","crypto_global_spot_derivatives_onchain","multi_timeframe_structure","entry_price_sanity"],
      actionable_top3_rule:"The supplied rows are the only mechanical candidates under review. Do not add a coin, promote an internal watch candidate, or invent a new price. SCOUT here means pending this exact 5AI approval, not a user recommendation.",
      entry_price_policy:"Use only the supplied trade_plan. PASS requires immediate entry to remain sensible inside entry_low..entry_high. Do not widen or chase the range.",
      required_crypto_axes:"Global spot consensus, derivatives, orderbook, onchain, multi-timeframe structure, listing risk and trade-plan risk/reward were mechanically checked and must be sanity-audited against current evidence."
    },
    observed_at:new Date().toISOString(),
    source_snapshot_ts:crypto.ts,
    market,macro,asset_flows:assets,sector_flows:sectors,representatives:reps,onchain,
    crypto:{snapshot_ts:crypto.ts,proposed_entries:proposed,actionable_top_count:proposed.length}
  };
}
function consensusVerified(c){return c?.verdict==="VERIFIED"&&c?.all_five_ok===true&&Number(c?.providers_success)===5&&Number(c?.evidence_quality)>=1&&Number(c?.conflict_count||0)===0;}
async function markRows(db,rows,consensus){
  const pass=consensusVerified(consensus);
  for(const row of rows){
    const d=row?.details&&typeof row.details==="object"?row.details:{};
    const ev=d.empirical_validation&&typeof d.empirical_validation==="object"?d.empirical_validation:{};
    const next={...d,five_ai_gate_ok:pass,entry_allowed:pass,top3_role:pass?"GLOBAL_FLOW_VERIFIED_INVESTMENT_CANDIDATE":"IMMEDIATE_ENTRY_PENDING_5AI",decision_reason:pass?"기계검증 + 동일 스냅샷 5AI 5/5 PASS · 즉시진입 허용":"기계검증 통과했지만 동일 스냅샷 5AI PASS 미충족 · 추천 차단",ai_verification:{verdict:consensus?.verdict||"MISSING",providers_success:Number(consensus?.providers_success||0),evidence_quality:Number(consensus?.evidence_quality||0),conflict_count:Number(consensus?.conflict_count||0)},empirical_validation:{...ev,recommendation_eligible:pass,mechanical_ready:true}};
    await db.from("gn_pre_pump_snapshots").update({status:pass?"ENTRY":"SCOUT",details:next}).eq("id",row.id);
  }
  return pass;
}

async function main({env=process.env,db=dbFromEnv(env)}={}){
  if(!explicitTrue(env.AI_PAID_REQUESTS_ENABLED)){console.log("Paid AI requests disabled; no provider requests sent.");return {skipped:"paid_disabled"};}
  const config=loadAiConfig(env);if(!config.enabled){console.log("AI analysis disabled; no provider requests sent.");return {skipped:"analysis_disabled"};}
  const crypto=await latestImmediateCrypto(db);
  if(!crypto.ts||!crypto.rows.length){console.log("No mechanically verified immediate-entry candidate; paid 5AI calls skipped.");return {skipped:"no_immediate_entry"};}
  if(await alreadyAudited(db,crypto.ts)){console.log(`Snapshot ${crypto.ts} already audited; duplicate paid 5AI calls skipped.`);return {skipped:"duplicate_snapshot",sourceTs:crypto.ts};}
  const evidence=await buildEvidenceBundle(db,crypto);
  const results=await analyzeSnapshot(evidence,config);
  await storeAnalyses(db,results,crypto.ts);
  const consensus=buildConsensus(results,crypto.ts);
  const stored=await storeConsensus(db,consensus);
  const promoted=await markRows(db,crypto.rows,consensus);
  console.log(JSON.stringify({ok:true,sourceTs:crypto.ts,candidates:crypto.rows.map(x=>x.market),promoted,consensus:stored,results:results.map(r=>({provider:r.provider,status:r.status,errorCode:r.errorCode||null}))}));
  return {stored,results,promoted};
}

if(require.main===module)main().catch(error=>{console.error(error?.code||error?.stack||error?.message||"AI_RUN_ERROR");process.exitCode=1;});
module.exports={alreadyAudited,buildEvidenceBundle,consensusVerified,latestImmediateCrypto,main,markRows};
