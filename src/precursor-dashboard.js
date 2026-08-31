"use strict";

const FRESH_MS=12*60*1000;
const EPISODE_MATCH_MS=30*60*1000;

function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function pct100(v){const n=num(v);return n==null?null:+(n*100).toFixed(2);}
function object(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}

function persistenceBucket(repeat){
  const n=Math.max(0,Number(repeat)||0);
  return n>=3?"REPEAT_3_PLUS":n===2?"REPEAT_2":"SINGLE";
}
function stageMeta(stage,repeat){
  const s=String(stage||"").toUpperCase();
  const n=Math.max(0,Number(repeat)||0);
  if(s==="REJECT_DECAY")return {code:"REJECT_DECAY",label:"약화/제외",tone:"bad"};
  if(s==="CONFIRMED_REPEAT_3"||n>=3)return {code:"CONFIRMED_REPEAT_3",label:"반복확정 3+",tone:"good"};
  if(s==="REPEAT_2"||n===2)return {code:"REPEAT_2",label:"반복 2회",tone:"warn"};
  return {code:s||"NEW",label:"신규 전조",tone:"neutral"};
}
function currentEpisode(row,outcomes){
  const anchor=new Date(row?.first_detected_at||row?.details?.first_detected_at||row?.ts||0).getTime();
  if(!Number.isFinite(anchor)||anchor<=0)return null;
  const candidates=(outcomes||[]).filter(x=>x?.market===row.market).map(x=>({row:x,delta:Math.abs(new Date(x.episode_start_ts).getTime()-anchor)})).filter(x=>Number.isFinite(x.delta)&&x.delta<=EPISODE_MATCH_MS).sort((a,b)=>a.delta-b.delta||new Date(b.row.episode_start_ts)-new Date(a.row.episode_start_ts));
  return candidates[0]?.row||null;
}
function mapOutcome(ep){
  if(!ep)return {state:"대기",ret15m:null,ret30m:null,ret1h:null,ret3h:null,mfe3h:null,mae3h:null,outcome:null,classification:null};
  return {
    state:ep.completed_at?"완료":"진행중",
    episodeStart:ep.episode_start_ts||null,
    lastSignalAt:ep.last_signal_ts||null,
    ret15m:pct100(ep.ret_15m),
    ret30m:pct100(ep.ret_30m),
    ret1h:pct100(ep.ret_1h),
    ret3h:pct100(ep.ret_3h),
    mfe3h:pct100(ep.mfe_3h),
    mae3h:pct100(ep.mae_3h),
    outcome:ep.outcome||null,
    classification:ep.entry_classification||null
  };
}
function actionFor({entryAllowed,status,stage,repeat,expansion}){
  if(entryAllowed&&String(status||"").toUpperCase()==="ENTRY")return {text:"진입검증",tone:"good",observationOnly:false};
  if(stage.code==="REJECT_DECAY")return {text:"제외",tone:"bad",observationOnly:true};
  if(repeat>=3&&num(expansion.score)>=80&&expansion.globalSpotOk===true&&expansion.derivativesOk===true)return {text:"우선감시",tone:"good",observationOnly:true};
  if(repeat>=2)return {text:"반복감시",tone:"warn",observationOnly:true};
  return {text:"전조감시",tone:"neutral",observationOnly:true};
}
function mapRow(row,outcomes,summaryByBucket){
  const d=object(row?.details),p=object(d.precursor),persist=object(p.persistence),expRaw=object(d.listing_expansion_evidence||d.expansion),ma=object(p.ma_transition),leader=object(d.leader_flow);
  const repeat=Math.max(1,Number(persist.repeat_count_30m||persist.consecutive_top3||leader.top3_count_2h||1));
  const stage=stageMeta(p.confidence_stage,repeat);
  const expansion={
    score:num(expRaw.score),
    thesis:expRaw.thesis||"확장근거 추가 확인 필요",
    globalSpotOk:expRaw.global_spot_ok===true,
    derivativesOk:expRaw.derivatives_ok===true,
    onchainOk:expRaw.onchain_ok===true,
    majorExchangeCount:num(expRaw.major_exchange_count)??(Array.isArray(d.foreign_venues)?d.foreign_venues.length:0)
  };
  const entryAllowed=d.entry_allowed===true;
  const action=actionFor({entryAllowed,status:row.status,stage,repeat,expansion});
  const ep=currentEpisode(row,outcomes);
  const bucket=persistenceBucket(repeat);
  const stats=summaryByBucket.get(bucket)||null;
  return {
    ...row,
    firstDetectedAt:row.first_detected_at||d.first_detected_at||row.ts||null,
    firstDetectedPrice:num(row.first_detected_price??d.first_detected_price),
    currentPrice:num(row.krw_price),
    riseSinceFirstPct:num(row.rise_since_first)!=null?+(num(row.rise_since_first)*100).toFixed(2):num(d.rise_since_first_pct),
    precursorStage:stage.code,
    stageLabel:stage.label,
    stageTone:stage.tone,
    repeatCount:repeat,
    persistence:{
      repeatCount30m:repeat,
      consecutiveTop3:Number(persist.consecutive_top3)||repeat,
      top3Count30m:Number(persist.top3_count_30m??persist.prior_top3_count_30m)||0,
      top6Count30m:Number(persist.top6_count_30m)||0,
      top6Count6h:Number(persist.top6_count_6h)||0,
      top12Count6h:Number(persist.top12_count_6h)||0
    },
    archetype:p.archetype||null,
    maScore:num(ma.score),
    maReasons:Array.isArray(ma.reasons)?ma.reasons:[],
    expansion,
    entryAllowed,
    fiveAiGateOk:d.five_ai_gate_ok===true,
    precursorAction:action.text,
    precursorActionTone:action.tone,
    observationOnly:action.observationOnly,
    postValidation:mapOutcome(ep),
    validationStats:stats?{
      bucket,
      episodes:Number(stats.episodes)||0,
      n1h:Number(stats.n_1h)||0,
      avg1hPct:num(stats.avg_1h_pct),
      win1h3Pct:num(stats.win_1h_3pct),
      n3h:Number(stats.n_3h)||0,
      avg3hPct:num(stats.avg_3h_pct),
      hit3h5Pct:num(stats.hit_3h_5pct),
      avgMfe3hPct:num(stats.avg_mfe_3h_pct),
      avgMae3hPct:num(stats.avg_mae_3h_pct)
    }:null
  };
}

async function loadPrecursorRadar(db){
  const latest=await db.from("gn_pre_pump_snapshots").select("ts").order("ts",{ascending:false}).limit(1).maybeSingle();
  if(latest.error)throw latest.error;
  const ts=latest.data?.ts||null;
  if(!ts)return {updatedAt:null,stale:true,rows:[],validationSummary:[]};
  const age=Date.now()-new Date(ts).getTime();
  if(!Number.isFinite(age)||age<0||age>FRESH_MS)return {updatedAt:ts,stale:true,rows:[],validationSummary:[]};
  const top=await db.from("gn_pre_pump_snapshots").select("*").eq("ts",ts).lte("rank",3).order("rank",{ascending:true});
  if(top.error)throw top.error;
  const markets=(top.data||[]).map(x=>x.market).filter(Boolean);
  let outcomes=[],summary=[];
  if(markets.length){
    const cutoff=new Date(Date.now()-8*3600*1000).toISOString();
    const out=await db.from("gn_precursor_outcomes").select("market,episode_start_ts,last_signal_ts,max_repeat_top3_30m,ret_15m,ret_30m,ret_1h,ret_3h,mfe_3h,mae_3h,outcome,entry_classification,completed_at").in("market",markets).gte("episode_start_ts",cutoff).order("episode_start_ts",{ascending:false});
    if(!out.error)outcomes=out.data||[];
  }
  const val=await db.from("gn_precursor_validation_summary").select("*");
  if(!val.error)summary=val.data||[];
  const map=new Map(summary.map(x=>[x.persistence_bucket,x]));
  return {updatedAt:ts,stale:false,rows:(top.data||[]).map(r=>mapRow(r,outcomes,map)),validationSummary:summary};
}

async function enrichLiveSummary(db,body){
  if(!body||typeof body!=="object"||Array.isArray(body))return body;
  try{
    const precursor=await loadPrecursorRadar(db);
    return {...body,cryptoRadar:precursor.rows,precursorUpdatedAt:precursor.updatedAt,precursorStale:precursor.stale,precursorValidation:precursor.validationSummary,precursorPolicy:"전조 → 반복 TOP3 → 해외현물·파생 확장검증 → 사후검증"};
  }catch(error){
    return {...body,cryptoRadar:[],precursorStale:true,precursorError:String(error?.message||error),precursorPolicy:"FAIL_CLOSED"};
  }
}

module.exports={actionFor,currentEpisode,enrichLiveSummary,loadPrecursorRadar,mapOutcome,mapRow,persistenceBucket,stageMeta};
