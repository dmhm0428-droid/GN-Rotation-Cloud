"use strict";

function toRow(result,sourceSnapshotTs){
  return {source_snapshot_ts:sourceSnapshotTs||null,provider:result.provider,model:result.model,status:result.status,summary:result.summary||null,
    sentiment:result.sentiment||null,confidence:Number.isFinite(result.confidence)?result.confidence:null,signals:Array.isArray(result.signals)?result.signals:[],
    usage:result.usage||{},cost_usd:Number.isFinite(result.costUsd)?result.costUsd:null,error_code:result.errorCode||null};
}
async function storeAnalyses(db,results,sourceSnapshotTs){
  const rows=results.map(r=>toRow(r,sourceSnapshotTs));if(!rows.length)return [];
  const {data,error}=await db.from("gn_ai_analyses").insert(rows).select("id,provider,status");if(error)throw error;return data||[];
}

module.exports={storeAnalyses,toRow};
