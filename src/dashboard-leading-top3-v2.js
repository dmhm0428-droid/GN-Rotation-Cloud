"use strict";

// Authoritative TOP3 semantics:
// TOP3 = money-flow/structure precursor candidates before expansion, not only immediate entries.
// Exact 5-AI verification upgrades a candidate to ENTRY; it never erases the precursor TOP3.
const expressPath=require.resolve("express");
const previousExpress=require("express");
const {createClient}=require("@supabase/supabase-js");
const {mapRow}=require("./precursor-dashboard");
const {selectLeadingTop3}=require("./leading-top3-policy");
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

const FRESH_MS=12*60*1000;
const HISTORY_MS=30*60*1000;
const HISTORY_LIMIT=120;
const POLICY="TOP3=폭발 전 선행후보. 최신 스캔 하나의 1~3위에 갇히지 않고 최근 30분 후보군의 종목별 최신 상태를 재검증해 후행·과열·20분 미재등장을 제거한 뒤 선행점수 상위 3개를 표시. 5AI는 TOP3 삭제 조건이 아니라 ENTRY 승격 조건.";

function latestByMarket(rows){
  const seen=new Set(),out=[];
  for(const row of Array.isArray(rows)?rows:[]){
    const market=String(row?.market||"");
    if(!market||seen.has(market))continue;
    seen.add(market);out.push(row);
  }
  return out;
}

async function loadBroadRadar(){
  const latest=await db.from("gn_pre_pump_snapshots").select("ts").order("ts",{ascending:false}).limit(1).maybeSingle();
  if(latest.error)throw latest.error;
  const ts=latest.data?.ts||null;
  if(!ts)return {updatedAt:null,stale:true,rows:[],nearMiss:[]};
  const age=Date.now()-new Date(ts).getTime();
  if(!Number.isFinite(age)||age<0||age>FRESH_MS)return {updatedAt:ts,stale:true,rows:[],nearMiss:[]};

  const historyCutoff=new Date(Date.now()-HISTORY_MS).toISOString();
  const pool=await db.from("gn_pre_pump_snapshots").select("*").gte("ts",historyCutoff).order("ts",{ascending:false}).order("rank",{ascending:true}).limit(HISTORY_LIMIT);
  if(pool.error)throw pool.error;
  const latestRows=latestByMarket(pool.data||[]);
  const markets=latestRows.map(x=>x.market).filter(Boolean);
  let outcomes=[],summary=[],readiness=[];
  if(markets.length){
    const cutoff=new Date(Date.now()-8*3600*1000).toISOString();
    const [out,ready]=await Promise.all([
      db.from("gn_precursor_outcomes").select("market,episode_start_ts,last_signal_ts,max_repeat_top3_30m,ret_15m,ret_30m,ret_1h,ret_3h,mfe_3h,mae_3h,outcome,entry_classification,completed_at").in("market",markets).gte("episode_start_ts",cutoff).order("episode_start_ts",{ascending:false}),
      db.from("gn_entry_readiness_v54").select("*").in("market",markets)
    ]);
    if(!out.error)outcomes=out.data||[];
    if(!ready.error)readiness=ready.data||[];
  }
  const val=await db.from("gn_precursor_validation_summary").select("*");
  if(!val.error)summary=val.data||[];
  const summaryMap=new Map(summary.map(x=>[x.persistence_bucket,x]));
  const readinessMap=new Map(readiness.map(x=>[x.market,x]));
  const now=Date.now();
  const mapped=latestRows.map(raw=>{
    const r=mapRow(raw,outcomes,summaryMap,readinessMap);
    const rowTs=new Date(raw.ts||0).getTime();
    const candidateAgeMin=Number.isFinite(rowTs)?Math.max(0,(now-rowTs)/60000):null;
    return {...r,candidateAgeMin:candidateAgeMin==null?null:+candidateAgeMin.toFixed(1),entryAllowed:false,strictImmediate:false};
  });
  const selected=selectLeadingTop3(mapped);
  return {updatedAt:ts,stale:false,rows:selected.top3,nearMiss:selected.nearMiss,poolSize:mapped.length};
}

function mergeImmediate(leading,body){
  const immediate=body?.immediateEntryGate?.status==="VERIFIED"&&Array.isArray(body?.cryptoRadar)?body.cryptoRadar:[];
  const imap=new Map(immediate.map(r=>[String(r.market||""),r]));
  const merged=(leading.rows||[]).map(r=>{
    const im=imap.get(String(r.market||""));
    if(!im)return {...r,entryAllowed:false,strictImmediate:false};
    return {...r,...im,
      top3Stage:"ENTRY",entryAllowed:true,strictImmediate:true,candidateAgeMin:r.candidateAgeMin,
      missingLeadConditions:r.missingLeadConditions||[],lagReasons:[],isLagging:false,
      firstDetectedAt:r.firstDetectedAt||im.firstDetectedAt,firstDetectedPrice:r.firstDetectedPrice??im.firstDetectedPrice,
      currentPrice:im.currentPrice??r.currentPrice,mechanicalScore:im.mechanicalScore??r.mechanicalScore,
      riseSinceFirstPct:r.riseSinceFirstPct
    };
  });
  const seen=new Set(merged.map(r=>String(r.market||"")));
  for(const im of immediate){
    const key=String(im.market||"");if(!key||seen.has(key))continue;
    merged.unshift({...im,top3Stage:"ENTRY",entryAllowed:true,strictImmediate:true,candidateAgeMin:0,missingLeadConditions:[],lagReasons:[],isLagging:false});seen.add(key);
  }
  const selected=selectLeadingTop3(merged);
  return {...leading,rows:selected.top3,nearMiss:leading.nearMiss||[]};
}

async function enforceLeadingTop3(body){
  if(!body||typeof body!=="object"||Array.isArray(body))return body;
  try{
    const leading=mergeImmediate(await loadBroadRadar(),body);
    return {...body,
      cryptoRadar:leading.rows,
      cryptoNearMiss:leading.nearMiss,
      precursorUpdatedAt:leading.updatedAt,
      precursorStale:leading.stale,
      cryptoTop3Policy:POLICY,
      cryptoTop3PoolSize:leading.poolSize||0
    };
  }catch(error){
    return {...body,cryptoTop3Policy:POLICY,cryptoTop3V2Error:String(error?.message||error)};
  }
}

const STYLE=`<style id="gn-leading-top3-v2-style">
.gnLeadCard{display:grid;grid-template-columns:34px 1fr auto;gap:10px;align-items:start;padding:13px 0;border-bottom:1px solid #242d36}.gnLeadRank{font-size:20px;font-weight:900;color:#8ea0b2}.gnLeadName{font-size:17px;font-weight:900}.gnLeadStage{display:inline-flex;border:1px solid currentColor;border-radius:999px;padding:2px 7px;margin-left:6px;font-size:10px;font-weight:900}.gnLeadStage.entry{color:#55d98b}.gnLeadStage.validated{color:#5ec8ff}.gnLeadStage.lead{color:#ffd166}.gnLeadStage.scout{color:#b5c0ca}.gnLeadPrice{font-size:12px;color:#c7d0da;margin-top:3px}.gnLeadMetrics,.gnLeadMissing{font-size:11px;line-height:1.5;margin-top:4px}.gnLeadMetrics{color:#9eabb8}.gnLeadMissing{color:#ffd166}.gnLeadAction{font-size:13px;font-weight:900;white-space:nowrap}.gnLeadAction.entry{color:#55d98b}.gnLeadAction.validated{color:#5ec8ff}.gnLeadAction.lead{color:#ffd166}.gnLeadAction.scout{color:#b5c0ca}.gnNearTitle{font-size:12px;font-weight:900;color:#8ea0b2;margin:8px 0 2px}.gnNear{opacity:.72}.gnPolicyNote{font-size:10px;color:#7f8d9a;margin-top:8px;line-height:1.45}
@media(max-width:560px){.gnLeadCard{grid-template-columns:26px 1fr}.gnLeadAction{grid-column:2}.gnLeadName{font-size:15px}}
</style>`;

const SCRIPT=`<script id="gn-leading-top3-v2-ui">(function(){
 var payload=null,rendering=false,oldFetch=window.fetch.bind(window);
 function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
 function n(v){var x=Number(v);return Number.isFinite(x)?x:null}
 function nf(v){var x=n(v);return x==null?'--':x.toLocaleString('ko-KR')}
 function pct(v){var x=n(v);return x==null?'--':(x>=0?'+':'')+x.toFixed(2)+'%'}
 function tm(v){if(!v)return '--';var d=new Date(v);return isNaN(d)?'--':d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false})}
 function stage(r){if(r.strictImmediate===true)return {key:'entry',label:'ENTRY',action:'진입검증 완료'};if(r.recommendationEligible===true)return {key:'validated',label:'검증후보',action:'진입 검증중'};if(r.empiricalValidation&&r.empiricalValidation.lead_core===true)return {key:'lead',label:'선행포착',action:'선행 감시'};return {key:'scout',label:'SCOUT',action:'전조 추적'}}
 function card(r,i,near){var s=stage(r),missing=Array.isArray(r.missingLeadConditions)?r.missingLeadConditions:[],lag=Array.isArray(r.lagReasons)?r.lagReasons:[];var first=r.firstDetectedPrice!=null?nf(r.firstDetectedPrice)+'원':'--';var now=r.currentPrice!=null?nf(r.currentPrice)+'원':'--';var price='현재 '+now+' · 최초 '+tm(r.firstDetectedAt)+' '+first+(r.riseSinceFirstPct!=null?' · 최초후 '+pct(r.riseSinceFirstPct):'');if(r.strictImmediate===true&&r.entryLow!=null)price+=' · 진입 '+nf(r.entryLow)+'~'+nf(r.entryHigh)+'원';var metrics='선행점수 '+nf(r.top3LeadScore)+' · 기계 '+nf(r.mechanicalScore)+' · MA정렬 '+nf(r.maAlignment)+'% · MA20 '+nf(r.ma20Slope)+' · OBV1H '+nf(r.obv1h)+' · 5분가속 '+nf(r.volumeAccel5m)+'배 · 반복 '+nf(r.repeatCount)+'회'+(r.candidateAgeMin!=null?' · '+nf(r.candidateAgeMin)+'분 전 포착':'');var miss=(near?lag.concat(missing):missing).slice(0,3);return '<article class="gnLeadCard '+(near?'gnNear':'')+'" data-gn-leading-card="1"><div class="gnLeadRank">'+(i+1)+'</div><div><div class="gnLeadName">'+esc(String(r.market||'').replace('KRW-',''))+'<span class="gnLeadStage '+s.key+'">'+s.label+'</span></div><div class="gnLeadPrice">'+price+'</div><div class="gnLeadMetrics">'+metrics+'</div>'+(miss.length?'<div class="gnLeadMissing">남은 조건 · '+esc(miss.join(' · '))+'</div>':'')+'</div><div class="gnLeadAction '+s.key+'">'+s.action+'</div></article>'}
 function render(){if(rendering||!payload)return;var box=document.getElementById('top3');if(!box)return;rendering=true;try{var rows=Array.isArray(payload.cryptoRadar)?payload.cryptoRadar:[],near=Array.isArray(payload.cryptoNearMiss)?payload.cryptoNearMiss:[];if(payload.precursorStale===true)box.innerHTML='<div class="empty">데이터 지연 · TOP3 판정 보류</div>';else if(rows.length)box.innerHTML=rows.slice(0,3).map(function(r,i){return card(r,i,false)}).join('')+'<div class="gnPolicyNote">TOP3는 이미 오른 종목이 아니라 돈 유입·구조 형성·과열 전 후보. 5AI는 ENTRY 승격에만 사용.</div>';else if(near.length)box.innerHTML='<div class="empty">현재 선행 TOP3 통과 종목 없음</div><div class="gnNearTitle">TOP3 직전 후보 · 부족 조건 표시</div>'+near.slice(0,3).map(function(r,i){return card(r,i,true)}).join('');else box.innerHTML='<div class="empty">현재 전조 후보 없음</div>';var sec=box.closest('section');if(sec){var t=sec.querySelector('.sectionTitle'),sub=sec.querySelector('.sub');if(t)t.textContent='크립토 선행 TOP3 · 폭발 전 후보';if(sub)sub.textContent='돈 유입 시작 + 구조 형성 + 과열 전 · 최근 30분 후보 재검증 → 후행/과열/미재등장 제거 → 상위 3개 · 5AI는 ENTRY 승격용';}var pill=document.getElementById('cryptoState');if(pill){var en=rows.filter(function(r){return r.strictImmediate===true}).length,sc=rows.length-en;pill.textContent='TOP3 '+rows.length+' · 전조 '+sc+' · ENTRY '+en;}}finally{setTimeout(function(){rendering=false},0)}}
 window.fetch=async function(){var args=[].slice.call(arguments),r=await oldFetch.apply(window,args);try{var u=String(args[0]&&args[0].url?args[0].url:args[0]||'');if(u.indexOf('/api/live-summary')>=0)r.clone().json().then(function(d){payload=d;setTimeout(render,60);setTimeout(render,240)}).catch(function(){})}catch(e){}return r};
 new MutationObserver(function(m){if(rendering||!payload)return;for(var i=0;i<m.length;i++){var target=m[i].target;if(target&&((target.id==='top3')||(target.closest&&target.closest('#top3')))){var b=document.getElementById('top3');if(b&&!b.querySelector('[data-gn-leading-card="1"]'))setTimeout(render,0);break}}}).observe(document.documentElement,{subtree:true,childList:true});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(render,0)});else setTimeout(render,0);
})();</script>`;

function patchHtml(html){if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("gn-leading-top3-v2-ui"))return html;return html.replace("</body>",STYLE+SCRIPT+"</body>");}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{
    if(req.path==="/api/live-summary"){
      const json=res.json.bind(res);
      res.json=function(body){Promise.resolve(enforceLeadingTop3(body)).then(out=>json(out)).catch(()=>json(body));return res;};
    }
    const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body));};next();
  });
  return app;
}
Object.assign(wrappedExpress,previousExpress);require.cache[expressPath].exports=wrappedExpress;
module.exports={POLICY,enforceLeadingTop3,latestByMarket,loadBroadRadar,mergeImmediate};
