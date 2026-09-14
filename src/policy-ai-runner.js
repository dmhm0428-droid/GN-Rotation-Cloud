"use strict";

const crypto=require("node:crypto");
const {createClient}=require("@supabase/supabase-js");
const {loadAiConfig}=require("./ai/config");
const {analyzeSnapshot}=require("./ai/analyzer");
const {updateAiProviderHealth}=require("./ai-entry-runner");

const AXES=["LONG_BOND_STABILITY","OIL_STABILITY","LIQUIDITY_SUPPLY","AI_CAPEX_SUPPORT","POWER_BITCOIN_NATIONAL_SECURITY","INVESTMENT_LINK"];
function explicitTrue(v){return /^(1|true|yes|on)$/i.test(String(v??""));}
function signal(result,key){const p=key+":";const v=(result?.signals||[]).find(x=>String(x).toUpperCase().startsWith(p));return v?String(v).slice(p.length).trim():null;}
function isTrue(v){return String(v||"").toLowerCase()==="true";}
function successful(results){return Array.isArray(results)&&results.length===5&&results.every(r=>r.status==="success");}
function audited(results){return successful(results)&&results.every(r=>String(signal(r,"GN_DATA_VERDICT")||"").toUpperCase()==="PASS");}
function axesOf(results){const found=new Set();for(const r of results)for(const a of String(signal(r,"GN_POLICY_AXES")||"").split(",").map(x=>x.trim().toUpperCase()))if(AXES.includes(a))found.add(a);return [...found];}
function dbFromEnv(env){const url=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Error("Supabase env vars missing");return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});}
async function latestPolicyAlert(db){const {data}=await db.from("gn_alerts").select("ts,message").eq("level","큰그림 정책").order("ts",{ascending:false}).limit(1).maybeSingle();return data||null;}
function baseBundle(prior){return {gn_contract:{mode:"BIG_PICTURE_POLICY_FIVE_AI",requirement:"Five independent agents must detect only new official or market-confirmed changes. No scoring and no investment command.",axes:AXES},observed_at:new Date().toISOString(),prior_checked_at:prior?.ts||null,hypotheses:["US preparation to stabilize long Treasury yields","US preparation to stabilize oil during the Iran/Hormuz conflict","Bowman and Bessent bank-regulation and Treasury-market liquidity channel","AI-company pacing followed by government power/data-center support","surplus-power Bitcoin mining and US-China national-security linkage"],required_output:"Detected facts only. Preserve user decision authority."};}
function secondBundle(base,first){return {...base,gn_contract:{...base.gn_contract,mode:"BIG_PICTURE_POLICY_REVERSE_VERIFICATION"},first_pass_claims:first.map(r=>({provider:r.provider,summary:r.summary,signals:r.signals}))};}
function compact(results){return results.map(r=>({provider:r.provider,status:r.status,errorCode:r.errorCode||null,summary:r.summary||null,signals:r.signals||[]}));}
function eventPayload(second){return {detected_at:new Date().toISOString(),axes:axesOf(second),providers:second.map(r=>({provider:r.provider,summary:r.summary,official_evidence:signal(r,"GN_OFFICIAL_EVIDENCE"),counter_evidence:signal(r,"GN_COUNTER_EVIDENCE")}))};}
async function main({env=process.env,db=dbFromEnv(env)}={}){
  if(!explicitTrue(env.AI_PAID_REQUESTS_ENABLED))return {skipped:"paid_disabled"};
  const config=loadAiConfig(env);if(!config.enabled)return {skipped:"analysis_disabled"};
  const prior=await latestPolicyAlert(db),base=baseBundle(prior);
  const first=await analyzeSnapshot(base,config);
  await updateAiProviderHealth(db,first);
  if(!successful(first)){console.log(JSON.stringify({policy_watch:"provider_failure",phase:"independent",results:compact(first)}));return {blocked:"first_pass_provider_failure",results:first};}
  const second=await analyzeSnapshot(secondBundle(base,first),config);
  await updateAiProviderHealth(db,second);
  if(!audited(second)){console.log(JSON.stringify({policy_watch:"reverse_verification_blocked",results:compact(second)}));return {blocked:"reverse_verification",results:second};}
  if(!second.every(r=>isTrue(signal(r,"GN_NEW_EVENT"))))return {ok:true,newEvent:false};
  const payload=eventPayload(second);if(!payload.axes.length)return {ok:true,newEvent:false};
  const fingerprint=crypto.createHash("sha256").update(JSON.stringify({axes:payload.axes,evidence:payload.providers.map(x=>x.official_evidence)})).digest("hex").slice(0,20);
  const {data:dupe}=await db.from("gn_alerts").select("id").eq("level","큰그림 정책").ilike("message",`%${fingerprint}%`).limit(1).maybeSingle();
  if(dupe?.id)return {ok:true,newEvent:false,duplicate:true};
  const message=JSON.stringify({...payload,fingerprint});
  const {error}=await db.from("gn_alerts").insert({coin:"GLOBAL",level:"큰그림 정책",stage:"탐지",message});if(error)throw error;
  console.log(JSON.stringify({ok:true,newEvent:true,axes:payload.axes,fingerprint}));return {ok:true,newEvent:true,payload};
}

if(require.main===module)main().catch(e=>{console.error(e?.code||e?.stack||e?.message||"POLICY_AI_ERROR");process.exitCode=1;});
module.exports={AXES,audited,axesOf,baseBundle,eventPayload,main,secondBundle,signal,successful};
