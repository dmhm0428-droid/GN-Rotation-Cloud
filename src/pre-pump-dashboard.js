"use strict";

// GN PIVOT TOP3 hard fail-closed guard.
// The previous scanner produced a materially negative 24h expectancy in live validation.
// Until a rebuilt engine passes out-of-sample validation, this endpoint must not expose
// stale/partial/AI-only candidates as actionable TOP3.

const LIVE_ENABLED=/^(1|true|yes|on)$/i.test(String(process.env.GN_TOP3_LIVE_ENABLED||"false"));
const MIN_SCORE=75;
const MAX_AGE_MS=20*60*1000;
const ACTIONABLE=new Set(["ENTRY"]);

const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};

function hardValidated(row){
  if(!row)return false;
  const d=row.details||{};
  const score=num(row.score);
  const price=num(row.krw_price);
  const entry=num(row.recommended_entry_krw);
  const age=Date.now()-new Date(row.ts).getTime();
  if(!ACTIONABLE.has(String(row.status||"").toUpperCase()))return false;
  if(score==null||score<MIN_SCORE)return false;
  if(!(price>0)||!(entry>0))return false;
  if(!Number.isFinite(age)||age<0||age>MAX_AGE_MS)return false;

  // Every mandatory gate must be explicitly true. Missing/null is failure, not neutral.
  if(d.entry_allowed!==true)return false;
  if(d.five_ai_gate_ok!==true)return false;
  if(d.quality_ok!==true)return false;
  if(d.entry_sanity_ok!==true)return false;
  if(d.global_spot_ok!==true)return false;
  if(d.multi_exchange_ok!==true)return false;
  if(d.onchain_ok!==true)return false;
  if(d.derivatives_ok!==true)return false;
  if(d.multi_timeframe_ok!==true)return false;
  if(d.cumulative_flow_ok!==true)return false;
  if(d.support_resistance_ok!==true)return false;
  if(d.risk_reward_ok!==true)return false;
  if(d.market_block===true||d.no_chase===true)return false;

  // Do not chase outside the validated entry band.
  const lo=num(row.recommended_entry_low);
  const hi=num(row.recommended_entry_high);
  if(!(lo>0)||!(hi>=lo))return false;
  if(price<lo||price>hi)return false;
  return true;
}

function formatCandidate(row,rank){
  return {
    rank,
    market:row.market,
    score:num(row.score),
    scannerStatus:row.status,
    status:"진입승인 · 모든 필수 게이트 통과",
    action:"진입",
    actionTone:"good",
    actionReason:"MTF·누적수급·글로벌 현물·멀티거래소·온체인·파생·지지/저항·손익비·진입가 검증 완료",
    hardBlock:false,
    krwPrice:num(row.krw_price),
    recommendedEntry:num(row.recommended_entry_krw),
    recommendedEntryLow:num(row.recommended_entry_low),
    recommendedEntryHigh:num(row.recommended_entry_high),
    updated_at:row.ts,
    maintenance:false
  };
}

async function loadLatestPrePump(db){
  if(!LIVE_ENABLED)return [];
  const latest=await db.from("gn_pre_pump_snapshots").select("run_id,ts").order("ts",{ascending:false}).limit(1).maybeSingle();
  if(latest.error)throw latest.error;
  if(!latest.data?.run_id)return [];
  const q=await db.from("gn_pre_pump_snapshots")
    .select("rank,market,score,status,krw_price,recommended_entry_krw,recommended_entry_low,recommended_entry_high,details,ts")
    .eq("run_id",latest.data.run_id)
    .order("rank",{ascending:true})
    .limit(20);
  if(q.error)throw q.error;
  return (q.data||[]).filter(hardValidated).sort((a,b)=>Number(b.score)-Number(a.score)).slice(0,3).map((r,i)=>formatCandidate(r,i+1));
}

function createLatestPrePumpHandler({db,load=loadLatestPrePump}){
  return async function(_req,res){
    try{
      const rows=await load(db);
      res.setHeader("Cache-Control","no-store");
      return res.json(rows);
    }catch(error){
      return res.status(503).json({error:"TOP3_MAINTENANCE",message:"TOP3 is fail-closed while the engine is being rebuilt and revalidated."});
    }
  };
}

// Compatibility exports retained so existing imports/tests do not crash.
function isDisplayableTopCandidate(row){return LIVE_ENABLED&&hardValidated(row);}
function classifyAction(){return {action:"검증중",tone:"muted",reason:"TOP3 재구축/재검증 중",hardBlock:true};}
function loadMultiTimeframe(){return Promise.resolve({available:false,error:"TOP3_MAINTENANCE"});}
function frameTrend(){return {available:false,score:null,label:"UNKNOWN"};}
function volumeContext(){return {score:null};}
function aggregateCandles(){return [];}
function recentReturn(){return null;}

module.exports={
  classifyAction,
  createLatestPrePumpHandler,
  formatCandidate,
  isDisplayableTopCandidate,
  loadLatestPrePump,
  loadMultiTimeframe,
  frameTrend,
  volumeContext,
  aggregateCandles,
  recentReturn,
  hardValidated
};
