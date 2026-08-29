"use strict";

const REQUIRED=["perplexity","xai","deepseek","anthropic","gemini"];

function signalValue(result,key){
  const prefix=key+":";
  const item=(result?.signals||[]).find(x=>String(x).toUpperCase().startsWith(prefix.toUpperCase()));
  return item?String(item).slice(prefix.length).trim():null;
}

function buildConsensus(results,sourceSnapshotTs){
  const by={};
  for(const r of results||[])by[r.provider]=r;
  const states={};
  let success=0;
  let explicitPass=0;
  const sentiments=[];
  const reasons=[];
  for(const name of REQUIRED){
    const r=by[name];
    const verdict=(signalValue(r,"GN_DATA_VERDICT")||"").toUpperCase();
    const ok=r?.status==="success";
    if(ok)success++;
    if(ok&&verdict==="PASS")explicitPass++;
    states[name]={status:r?.status||"missing",verdict:verdict||null,sentiment:r?.sentiment||null,confidence:r?.confidence??null,errorCode:r?.errorCode||null};
    if(ok&&r?.sentiment)sentiments.push(r.sentiment);
    if(!ok)reasons.push(`${name}:NOT_SUCCESS`);
    else if(verdict!=="PASS")reasons.push(`${name}:VERDICT_${verdict||"MISSING"}`);
  }
  const counts={risk_on:0,neutral:0,risk_off:0};
  for(const s of sentiments)if(Object.prototype.hasOwnProperty.call(counts,s))counts[s]++;
  const dominant=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]||"neutral";
  const max=Math.max(...Object.values(counts));
  const agreement=success?max/success:0;
  const hardConflict=counts.risk_on>0&&counts.risk_off>0;
  if(hardConflict)reasons.push("SENTIMENT_CONFLICT");
  const allFiveOk=success===REQUIRED.length&&explicitPass===REQUIRED.length&&!hardConflict;
  const verdict=allFiveOk?"VERIFIED":success===REQUIRED.length?"CONFLICT":"PARTIAL";
  return {
    source_snapshot_ts:sourceSnapshotTs||null,
    verdict,
    all_five_ok:allFiveOk,
    providers_expected:REQUIRED.length,
    providers_success:success,
    agreement_ratio:Number(agreement.toFixed(4)),
    dominant_sentiment:dominant,
    conflict_count:hardConflict?1:0,
    evidence_quality:Number((explicitPass/REQUIRED.length).toFixed(4)),
    provider_states:states,
    reasons
  };
}

async function storeConsensus(db,row){
  const {data,error}=await db.from("gn_ai_consensus").insert(row).select("id,created_at,verdict,all_five_ok,providers_success,evidence_quality").single();
  if(error)throw error;
  return data;
}

module.exports={REQUIRED,buildConsensus,storeConsensus,signalValue};
