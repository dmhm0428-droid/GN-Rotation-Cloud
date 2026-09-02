"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");
const {createClient}=require("@supabase/supabase-js");
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

async function latestPerKey(table,keyFn,limit=1000){
  const {data,error}=await db.from(table).select("*").order("ts",{ascending:false}).limit(limit);
  if(error)throw error;
  const seen=new Set(),out=[];
  for(const row of data||[]){const key=keyFn(row);if(!key||seen.has(key))continue;seen.add(key);out.push(row);}
  return out;
}
function mergeByKey(fallback,latest,keyFn){
  const m=new Map();
  for(const row of fallback||[]){const key=keyFn(row);if(key)m.set(key,row);}
  for(const row of latest||[]){const key=keyFn(row);if(key)m.set(key,Object.assign({},m.get(key)||{},row));}
  return [...m.values()];
}
async function rotationLatest(req,res){
  try{
    const [summaryR,viewAssetsR,viewSectorsR,rawAssets,rawSectors]=await Promise.all([
      db.from("gn_latest_rotation_summary").select("*").limit(1).maybeSingle(),
      db.from("gn_latest_asset_rotation").select("*").order("rank",{ascending:true}),
      db.from("gn_latest_sector_rotation").select("*").order("rank",{ascending:true}),
      latestPerKey("gn_asset_flow_scores",r=>r?.asset_class||null,1000),
      latestPerKey("gn_sector_flow_scores",r=>`${r?.asset_class||"STOCK"}:${r?.sector||""}`,1000)
    ]);
    if(summaryR.error)throw summaryR.error;
    const viewAssets=viewAssetsR.error?[]:(viewAssetsR.data||[]),viewSectors=viewSectorsR.error?[]:(viewSectorsR.data||[]);
    const assets=mergeByKey(viewAssets,rawAssets,r=>r?.asset_class||null).sort((a,b)=>(Number(a.rank)||99)-(Number(b.rank)||99));
    const sectors=mergeByKey(viewSectors,rawSectors,r=>`${r?.asset_class||"STOCK"}:${r?.sector||""}`).sort((a,b)=>(Number(a.rank)||99)-(Number(b.rank)||99));
    res.set("Cache-Control","no-store");
    res.json({ts:new Date().toISOString(),summary:summaryR.data||null,assets,sectors});
  }catch(e){res.status(500).json({error:String(e?.message||e)});}
}

const BLOCK=`<style id="gn-rotation-style-v1">
.rotationPanel{background:#0e141a;border:1px solid #2b3742;border-radius:16px;padding:13px;margin-top:12px}.rotationSummary{font-size:16px;font-weight:900;margin:4px 0 10px}.rotationGrid{display:grid;gap:7px}.rotationRow{display:grid;grid-template-columns:74px 42px 58px 58px 58px 1fr;align-items:center;gap:6px;padding:9px 10px;background:#121a21;border:1px solid #26323d;border-radius:11px;font-size:12px}.rotationRow b{font-size:13px}.rotationHead{color:#7f8d99;font-size:10px;background:transparent;border:0;padding-top:0;padding-bottom:3px}.rotUp{color:#55d98b}.rotDown{color:#ff7b7b}.rotFlat{color:#b7c1cb}.sectorFlow{display:flex;gap:7px;overflow-x:auto;padding-top:10px}.sectorFlow>div{min-width:132px;background:#121a21;border:1px solid #26323d;border-radius:11px;padding:9px}.sectorFlow b,.sectorFlow small{display:block}.sectorFlow small{color:#8d9aa6;font-size:10px;margin-top:3px}@media(max-width:560px){.rotationRow{grid-template-columns:68px 36px 50px 50px 48px 1fr;font-size:11px;padding:8px 7px}}
</style>
<section id="moneyRotationSection"><div class="sectionHead"><div><div class="sectionTitle">자산군 자금회전 · 상대강도</div><div class="sub">돈의 발자국 조건은 유지 · 현재 RS와 단기 가속도로 이동 방향 표시</div></div><div id="rotationLeader" class="pill">계산 중</div></div><div class="rotationPanel"><div id="rotationSummary" class="rotationSummary">자산군 회전 계산 중…</div><div class="rotationGrid"><div class="rotationRow rotationHead"><b>자산군</b><span>순위</span><span>RS 1D</span><span>RS 5D</span><span>가속</span><span>단계</span></div><div id="rotationRows"></div></div><div class="sectorFlow" id="sectorRotation"><div>섹터 회전 계산 중…</div></div></div></section>
<script id="gn-rotation-script-v3">(function(){
const $=id=>document.getElementById(id),num=v=>Number(v),f=v=>Number.isFinite(num(v))?num(v).toFixed(1):'--',esc=v=>String(v==null?'':v).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const names={CRYPTO:'크립토',STOCK:'미국주식',KOREA_STOCK:'한국주식',GOLD:'금',COMMODITY:'원자재',BOND:'채권',CASH:'현금'};
const stages={LEADING_ACCELERATING:'선두·가속',LEADING:'선두',STRENGTHENING:'강화',WEAKENING:'약화',DEFENSIVE:'방어',NEUTRAL:'중립',DATA_WAIT:'데이터대기'};
const expected=['STOCK','KOREA_STOCK','CRYPTO','BOND','GOLD','COMMODITY','CASH'];
function cls(v){return num(v)>1?'rotUp':num(v)<-1?'rotDown':'rotFlat'}
function arrow(v){return num(v)>1?'↑':num(v)<-1?'↓':'→'}
async function loadRotation(){try{const r=await fetch('/api/rotation/latest?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json(),s=d.summary||{},rows=d.assets||[],have=new Set(rows.map(x=>x.asset_class)),displayRows=rows.concat(expected.filter(k=>!have.has(k)).map(k=>({asset_class:k,rank:'--',rs_1d:null,rs_5d:null,flow_acceleration:null,flow_stage:'DATA_WAIT'})));$('rotationLeader').textContent='선두 '+(names[s.leader_asset]||s.leader_asset||'--');$('rotationSummary').textContent=s.rotation_summary&&s.rotation_summary!=='뚜렷한 자산군 회전 없음'?(names[s.rotation_from]||s.rotation_from)+' ↓ → '+(names[s.rotation_to]||s.rotation_to)+' ↑':'뚜렷한 자산군 이동 없음';$('rotationRows').innerHTML=displayRows.map(x=>'<div class="rotationRow"><b>'+esc(names[x.asset_class]||x.asset_class)+'</b><span>'+esc(x.rank)+(num(x.rank_change)>0?' ↑'+x.rank_change:num(x.rank_change)<0?' ↓'+Math.abs(x.rank_change):'')+'</span><span>'+f(x.rs_1d)+'</span><span>'+f(x.rs_5d)+'</span><span class="'+cls(x.flow_acceleration)+'">'+arrow(x.flow_acceleration)+' '+f(Math.abs(num(x.flow_acceleration)))+'</span><span class="'+cls(x.flow_acceleration)+'">'+esc(stages[x.flow_stage]||x.flow_stage||'--')+'</span></div>').join('');$('sectorRotation').innerHTML=(d.sectors||[]).slice(0,8).map(x=>'<div><b>'+esc(String(x.sector||'').replaceAll('_',' '))+'</b><small>'+(x.asset_class?esc(names[x.asset_class]||x.asset_class)+' · ':'')+'순위 '+esc(x.rank)+' · RS1D '+f(x.rs_1d)+' · RS5D '+f(x.rs_5d)+'</small><small class="'+cls(x.flow_acceleration)+'">'+arrow(x.flow_acceleration)+' 가속 '+f(Math.abs(num(x.flow_acceleration)))+' · '+esc(stages[x.flow_stage]||x.flow_stage||'')+'</small></div>').join('')||'<div>섹터 데이터 없음</div>';}catch(e){if($('rotationSummary'))$('rotationSummary').textContent='자금회전 데이터 재조회 중';}}
setTimeout(loadRotation,200);setInterval(loadRotation,15000);window.loadRotation=loadRotation;})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("<title>GN PIVOT</title>")||html.includes("gn-rotation-script-v3"))return html;
  const marker='<section><div class="sectionHead"><div><div class="sectionTitle">오늘의 대표 선수</div>';
  if(html.includes(marker))return html.replace(marker,BLOCK+marker);
  return html.replace('</body>',BLOCK+'</body>');
}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.get("/api/rotation/latest",rotationLatest);
  app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});return app;
}
Object.assign(wrappedExpress,previousExpress);require.cache[expressPath].exports=wrappedExpress;