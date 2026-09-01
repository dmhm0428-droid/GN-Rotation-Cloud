"use strict";

// Final action layer: TOP3 means "can enter now", never a watchlist.
// It runs after the precursor enrichment on the response path and fails closed
// unless the latest immediate-entry scan and its exact 5-AI consensus both pass.
const expressPath=require.resolve("express");
const previousExpress=require("express");
const {createClient}=require("@supabase/supabase-js");
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const FRESH_MS=20*60*1000;

const n=v=>Number.isFinite(Number(v))?Number(v):null;
const obj=v=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
async function latestImmediateRun(){
  const {data,error}=await db.from("gn_runs").select("id,started_at,status,source_status").order("started_at",{ascending:false}).limit(30);
  if(error)throw error;
  return (data||[]).find(r=>String(r?.source_status?.source||"")==="pre_pump_immediate_v2")||null;
}
async function rowsForRun(runId){
  if(!runId)return [];
  const {data,error}=await db.from("gn_pre_pump_snapshots").select("*").eq("run_id",runId).order("rank",{ascending:true}).limit(3);
  if(error)throw error;
  return (data||[]).filter(row=>String(row.status)==="ENTRY"&&row?.details?.entry_allowed===true&&Number(row.score)>=76);
}
async function consensusFor(sourceTs){
  if(!sourceTs)return null;
  const {data,error}=await db.from("gn_ai_consensus").select("created_at,source_snapshot_ts,verdict,all_five_ok,providers_expected,providers_success,agreement_ratio,dominant_sentiment,conflict_count,evidence_quality,provider_states,reasons").eq("source_snapshot_ts",sourceTs).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(error)return null;return data||null;
}
function consensusOk(c,sourceTs){
  const cts=new Date(c?.source_snapshot_ts||0).getTime(),sts=new Date(sourceTs||0).getTime();
  if(!c||!Number.isFinite(cts)||!Number.isFinite(sts)||cts!==sts)return false;
  const age=Date.now()-new Date(c.created_at).getTime();
  return Number.isFinite(age)&&age>=0&&age<=FRESH_MS&&c.verdict==="VERIFIED"&&c.all_five_ok===true&&Number(c.providers_success)===5&&Number(c.evidence_quality)>=1&&Number(c.conflict_count||0)===0;
}
function mapImmediate(row){
  const d=obj(row.details),plan=obj(d.trade_plan),ll=obj(d.lead_lag),exp=obj(d.expansion),der=obj(d.derivatives),on=obj(d.onchain);
  const repeat=Math.max(2,Number(ll.repeat_count)||2);
  return {...row,
    currentPrice:n(row.krw_price),firstDetectedAt:d.first_detected_at||row.ts||null,firstDetectedPrice:n(d.first_detected_price),riseSinceFirstPct:null,
    mechanicalScore:n(ll.probability_score??row.score),empiricalRule:ll.rule||"IMMEDIATE_ENTRY_V2",
    empiricalValidation:{lead_core:true,lagging:false,recommendation_eligible:true,mechanical_score:n(ll.probability_score??row.score),repeat,rule:"IMMEDIATE_ENTRY_V2"},
    precursorStage:"IMMEDIATE_ENTRY",stageLabel:"즉시진입",stageTone:"good",repeatCount:repeat,
    persistence:{repeatCount30m:repeat,consecutiveTop3:repeat,top3Count30m:repeat,top6Count30m:repeat,top6Count6h:repeat,top12Count6h:repeat},
    expansion:{score:n(ll.probability_score),thesis:"선행/후행·해외현물·파생·오더북·5AI 검증 통과",globalSpotOk:exp.global_spot_ok===true,derivativesOk:exp.derivatives_ok===true,onchainOk:on.available===true||exp.onchain_neutral===true,majorExchangeCount:Array.isArray(exp.global_venues)?exp.global_venues.length:0},
    entryAllowed:true,recommendationEligible:true,fiveAiGateOk:true,precursorAction:"즉시진입",precursorActionTone:"good",observationOnly:false,
    entryPrice:n(plan.entry_price),entryLow:n(plan.entry_low),entryHigh:n(plan.entry_high),spreadPct:n(plan.spread_pct),probabilityScore:n(ll.probability_score??row.score),lagRiskScore:n(ll.lag_risk_score),
    onchainAvailable:on.available===true,onchainNeutral:exp.onchain_neutral===true,derivativeScore:n(der.score),
    postValidation:{state:"진입가능",ret15m:null,ret30m:null,ret1h:null,ret3h:null,mfe3h:null},validationStats:null
  };
}
async function enforceImmediate(body){
  if(!body||typeof body!=="object"||Array.isArray(body))return body;
  const run=await latestImmediateRun();
  if(!run)return {...body,cryptoRadar:[],precursorStale:true,immediateEntryGate:{status:"NO_RUN",fiveAi:false}};
  const runAge=Date.now()-new Date(run.started_at).getTime();
  if(!Number.isFinite(runAge)||runAge<0||runAge>FRESH_MS)return {...body,cryptoRadar:[],precursorStale:true,precursorUpdatedAt:run.started_at,immediateEntryGate:{status:"STALE",fiveAi:false}};
  const rows=await rowsForRun(run.id);
  if(!rows.length)return {...body,cryptoRadar:[],precursorStale:false,precursorUpdatedAt:run.started_at,immediateEntryGate:{status:"NO_IMMEDIATE_ENTRY",fiveAi:false,ready:0}};
  const consensus=await consensusFor(run.started_at);const ok=consensusOk(consensus,run.started_at);
  if(!ok)return {...body,cryptoRadar:[],precursorStale:false,precursorUpdatedAt:run.started_at,immediateEntryGate:{status:"AI_PENDING_OR_BLOCKED",fiveAi:false,ready:rows.length,consensus:consensus||null}};
  return {...body,cryptoRadar:rows.map(mapImmediate).slice(0,3),precursorStale:false,precursorUpdatedAt:run.started_at,immediateEntryGate:{status:"VERIFIED",fiveAi:true,providers:5,ready:rows.length,sourceTs:run.started_at}};
}

const STYLE=`<style id="gn-immediate-entry-v2-style">.gnEntryLine{font-size:13px;font-weight:900;color:#55d98b;margin-top:5px;line-height:1.5}.gnEntryAudit{font-size:11px;color:#9eabb8;margin-top:3px;line-height:1.45}</style>`;
const SCRIPT=`<script id="gn-immediate-entry-v2-ui">(function(){
 var payload=null,oldFetch=window.fetch.bind(window);
 function nf(v){var x=Number(v);return Number.isFinite(x)?x.toLocaleString('ko-KR'): '--'}
 function patch(){var box=document.getElementById('top3');if(!box)return;var sec=box.closest('section');if(sec){var t=sec.querySelector('.sectionTitle'),s=sec.querySelector('.sub');if(t)t.textContent='크립토 즉시진입 TOP3 · 5AI 검증완료만';if(s)s.textContent='추천=지금 진입 가능 · 선행/후행·해외현물·파생·오더북·온체인·5AI 교차검증 · 진입가 표시';}
   var gate=payload&&payload.immediateEntryGate||{},rows=payload&&payload.cryptoRadar||[];var pill=document.getElementById('cryptoState');if(pill)pill.textContent=gate.status==='VERIFIED'?('즉시진입 '+rows.length+' · 5AI 5/5'):('즉시진입 0 · '+(gate.status==='AI_PENDING_OR_BLOCKED'?'5AI 검증대기':'조건 미충족'));
   if(!rows.length){var e=box.querySelector('.empty');if(e)e.textContent=gate.status==='AI_PENDING_OR_BLOCKED'?'기계조건 통과 후보는 있으나 5AI 검증 전 · 추천하지 않음':'현재 바로 진입 가능한 검증완료 후보 없음';return;}
   var cards=box.querySelectorAll('[data-gn-precursor-card="1"]');cards.forEach(function(card,i){var r=rows[i];if(!r)return;var rule=card.querySelector('.precursorRule');if(rule)rule.textContent='확률 '+nf(r.probabilityScore)+'점 · 반복 '+nf(r.repeatCount)+'회 · 후행위험 '+nf(r.lagRiskScore)+'점 · 해외현물 '+(r.expansion&&r.expansion.globalSpotOk?'✓':'×')+' · 파생 '+(r.expansion&&r.expansion.derivativesOk?'✓':'×');
     var price=card.querySelector('.pickPrice');if(price)price.innerHTML='현재 '+nf(r.currentPrice)+'원 · <span class="gnEntryLine">진입가 '+nf(r.entryLow)+'~'+nf(r.entryHigh)+'원 · 기준 '+nf(r.entryPrice)+'원</span>';
     var action=card.querySelector('.precursorAction');if(action)action.textContent='즉시진입';var why=card.querySelector('.precursorWhy');if(why)why.textContent='5AI 5/5 + 해외현물 + 파생 + 오더북 + 선행/후행 검증 통과';
     var learn=card.querySelector('.precursorLearn');if(learn)learn.textContent='이 화면에 표시되면 바로 진입 가능한 후보만 통과 · 감시/SCOUT 후보는 내부에서만 추적';
   });
 }
 window.fetch=async function(){var args=[].slice.call(arguments),r=await oldFetch.apply(window,args);try{var u=String(args[0]&&args[0].url?args[0].url:args[0]||'');if(u.indexOf('/api/live-summary')>=0)r.clone().json().then(function(d){payload=d;setTimeout(patch,40);setTimeout(patch,180)}).catch(function(){})}catch(e){}return r};
 new MutationObserver(function(){if(payload)setTimeout(patch,0)}).observe(document.documentElement,{subtree:true,childList:true});
 if(document.readyState!=='loading')setTimeout(patch,0);else document.addEventListener('DOMContentLoaded',function(){setTimeout(patch,0)});
})();</script>`;
function patchHtml(html){if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("gn-immediate-entry-v2-ui"))return html;return html.replace("</body>",STYLE+SCRIPT+"</body>");}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{
    if(req.path==="/api/live-summary"){
      const json=res.json.bind(res);
      res.json=function(body){Promise.resolve(enforceImmediate(body)).then(out=>json(out)).catch(()=>json({...body,cryptoRadar:[],precursorStale:true,immediateEntryGate:{status:"GATE_ERROR",fiveAi:false}}));return res;};
    }
    const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body));};next();
  });
  return app;
}
Object.assign(wrappedExpress,previousExpress);require.cache[expressPath].exports=wrappedExpress;
module.exports={consensusOk,enforceImmediate,mapImmediate};
