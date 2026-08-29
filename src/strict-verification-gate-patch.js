"use strict";

// Fail-closed gate between raw/scanner data and the action dashboard.
// Nothing can appear as actionable TOP3 unless the latest five-AI consensus is VERIFIED.
const expressPath=require.resolve("express");
const previousExpress=require("express");
const {createClient}=require("@supabase/supabase-js");
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

async function latestConsensus(){
  try{
    const {data,error}=await db.from("gn_ai_consensus").select("created_at,source_snapshot_ts,verdict,all_five_ok,providers_expected,providers_success,agreement_ratio,dominant_sentiment,conflict_count,evidence_quality,provider_states,reasons").order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(error||!data)return {verdict:"MISSING",all_five_ok:false,providers_expected:5,providers_success:0,evidence_quality:0,reasons:["CONSENSUS_QUERY_FAILED"]};
    const ageMin=(Date.now()-new Date(data.created_at).getTime())/60000;
    if(!Number.isFinite(ageMin)||ageMin>25)return {...data,verdict:"STALE",all_five_ok:false,reasons:[...(data.reasons||[]),"CONSENSUS_STALE"]};
    return data;
  }catch(e){return {verdict:"ERROR",all_five_ok:false,providers_expected:5,providers_success:0,evidence_quality:0,reasons:["CONSENSUS_ERROR"]};}
}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function strictCandidate(r){
  const status=String(r?.status||r?.scannerStatus||"").toUpperCase();
  const score=n(r?.score);
  const role=String(r?.top3_role||r?.role||r?.details?.top3_role||"");
  const lo=n(r?.recommended_entry_low??r?.details?.trade_plan?.entry_low);
  const hi=n(r?.recommended_entry_high??r?.details?.trade_plan?.entry_high);
  const px=n(r?.krw_price??r?.price??r?.currentPrice);
  const d=r?.details||{};
  const weekly=d.weekly_valid??d.weeklyValid??d.persistence?.weekly??true;
  const globalCoverage=n(d.global_coverage??d.globalCoverage??d.global?.coverage);
  const crossCoverage=n(d.cross_coverage??d.crossCoverage??d.cross_exchange?.coverage);
  const onchainQuality=n(d.onchain_data_quality??d.onchainDataQuality??d.onchain?.quality);
  if(status!=="ENTRY"&&status!=="SCOUT")return false;
  if(status==="ENTRY"&&!(score>=76))return false;
  if(status==="SCOUT"&&!(score>=68))return false;
  if(role!=="GLOBAL_FLOW_VERIFIED_INVESTMENT_CANDIDATE")return false;
  if(weekly===false)return false;
  if(globalCoverage!=null&&globalCoverage<0.67)return false;
  if(crossCoverage!=null&&crossCoverage<0.5)return false;
  if(onchainQuality===0)return false;
  if(lo==null||hi==null||lo>hi)return false;
  if(px!=null&&lo>px*1.01)return false;
  return true;
}
function consensusOk(c){return c?.verdict==="VERIFIED"&&c?.all_five_ok===true&&Number(c?.providers_success)===5&&Number(c?.evidence_quality)>=1&&Number(c?.conflict_count||0)===0;}

const SCRIPT=`<script>(function(){
  var oldLoad=window.loadAll;
  if(typeof oldLoad!=='function'||window.__gnFiveAiGateUi)return;
  window.__gnFiveAiGateUi=true;
  window.loadAll=async function(){
    await oldLoad();
    try{
      var r=await fetch('/api/flow-map');if(!r.ok)return;var x=await r.json();var c=x.aiConsensus||{};
      var ok=c.verdict==='VERIFIED'&&c.all_five_ok===true&&Number(c.providers_success)===5;
      var pill=document.getElementById('cryptoState');if(pill)pill.textContent=ok?'AI 5/5 검증완료':'AI '+Number(c.providers_success||0)+'/5 · ENTRY 차단';
      if(!ok){var h=document.getElementById('decisionHero');if(h)h.innerHTML='<div class="heroLabel">지금 해야 할 일</div><div class="heroAction bad">신규진입 중단</div><div class="heroReason">5개 AI 검증 미완료 · '+String(c.verdict||'MISSING')+' · 원시데이터는 행동판정에 사용하지 않음</div>';}
    }catch(e){}
  };
  setTimeout(window.loadAll,1000);
})();</script>`;
function patchHtml(body){if(typeof body!=="string"||!body.includes("GN PIVOT")||body.includes("__gnFiveAiGateUi"))return body;return body.replace("</body>",SCRIPT+"</body>");}

function strictExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{
    if(req.path==="/api/flow-map"){
      const json=res.json.bind(res);
      res.json=async function(body){
        const c=await latestConsensus();const ok=consensusOk(c);const out=body&&typeof body==="object"&&!Array.isArray(body)?{...body,aiConsensus:c}:body;
        if(out&&typeof out==="object"&&!Array.isArray(out)){
          out.cryptoTop=ok?(Array.isArray(out.cryptoTop)?out.cryptoTop.filter(strictCandidate).slice(0,3):[]):[];
          out.verification={status:ok?"VERIFIED":"BLOCKED",five_ai:ok,providers_success:Number(c.providers_success||0),required:5};
        }
        return json(out);
      };
    }
    if(req.path==="/api/pre-pump/latest"){
      const json=res.json.bind(res);
      res.json=async function(body){const c=await latestConsensus();if(!consensusOk(c))return json([]);return json(Array.isArray(body)?body.filter(strictCandidate).slice(0,3):body);};
    }
    const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body));};
    next();
  });
  return app;
}
Object.assign(strictExpress,previousExpress);
require.cache[expressPath].exports=strictExpress;
