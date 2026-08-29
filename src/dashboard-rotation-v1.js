"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");
const {createClient}=require("@supabase/supabase-js");
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

const REP_FIELDS="ts,asset_class,sector,symbol,venue,rank,total_score,macro_score,flow_score,relative_strength,technical_score,valuation_room,onchain_score,derivatives_score,catalyst_score,risk_score,price,entry_low,entry_high,invalidation,action,data_quality,reasons,components";
const CRYPTO_FIELDS="ts,market,rank,score,status,krw_price,first_detected_at,first_detected_price,rise_since_first,recommended_entry_krw,recommended_entry_low,recommended_entry_high,is_new_listing,foreign_exchange,foreign_listing_date,foreign_listing_price_krw,foreign_price,foreign_support_krw,listing_risk,listing_stage,listing_thesis,listing_thesis_score";

async function rotationLatest(req,res){
  try{
    const [summaryR,assetsR,sectorsR,repsR,stockRepsR,cryptoR]=await Promise.all([
      db.from("gn_latest_rotation_summary").select("*").limit(1).maybeSingle(),
      db.from("gn_latest_asset_rotation").select("*").order("rank",{ascending:true}),
      db.from("gn_latest_sector_rotation").select("*").order("rank",{ascending:true}),
      db.from("gn_latest_asset_representatives").select(REP_FIELDS).order("asset_class",{ascending:true}).order("rank",{ascending:true}),
      db.from("gn_latest_stock_sector_representatives").select(REP_FIELDS).order("sector",{ascending:true}).order("rank",{ascending:true}),
      db.from("gn_pre_pump_snapshots").select(CRYPTO_FIELDS).order("ts",{ascending:false}).limit(24)
    ]);
    const err=summaryR.error||assetsR.error||sectorsR.error;
    if(err)throw err;
    res.set("Cache-Control","no-store");
    res.json({
      ts:new Date().toISOString(),
      summary:summaryR.data||null,
      assets:assetsR.data||[],
      sectors:sectorsR.data||[],
      representatives:repsR.error?[]:(repsR.data||[]),
      stockRepresentatives:stockRepsR.error?[]:(stockRepsR.data||[]),
      cryptoCandidates:cryptoR.error?[]:(cryptoR.data||[])
    });
  }catch(e){res.status(500).json({error:String(e?.message||e)});}
}

const BLOCK=`<style id="gn-rotation-style-v1">
.rotationPanel{background:#0e141a;border:1px solid #2b3742;border-radius:16px;padding:13px;margin-top:12px}
.rotationSummary{font-size:16px;font-weight:900;margin:4px 0 10px}
.rotationGrid{display:grid;gap:7px}
.rotationRow{display:grid;grid-template-columns:74px 42px 58px 58px 58px 1fr;align-items:center;gap:6px;padding:9px 10px;background:#121a21;border:1px solid #26323d;border-radius:11px;font-size:12px;color:inherit;text-align:left;width:100%}
.rotationRow b{font-size:13px}.rotationHead{color:#7f8d99;font-size:10px;background:transparent;border:0;padding-top:0;padding-bottom:3px}
button.rotationRow{appearance:none;font:inherit;cursor:pointer}
button.rotationRow:focus-visible,.sectorCard:focus-visible,.drillClose:focus-visible{outline:2px solid #f4c85a;outline-offset:2px}
.rotationRow.isActive,.sectorCard.isActive{border-color:#f4c85a;background:#171d22}
.rotUp{color:#55d98b}.rotDown{color:#ff7b7b}.rotFlat{color:#b7c1cb}
.sectorFlow{display:flex;gap:7px;overflow-x:auto;padding-top:10px;padding-bottom:2px}
.sectorCard{min-width:150px;background:#121a21;border:1px solid #26323d;border-radius:11px;padding:10px;color:inherit;text-align:left;appearance:none;cursor:pointer}
.sectorCard b,.sectorCard small{display:block}.sectorCard b{font-size:13px}.sectorCard small{color:#8d9aa6;font-size:10px;margin-top:3px}
.drillHint{font-size:10px;color:#7f8d99;margin-top:7px}
.rotationDrilldown{margin-top:12px;border-top:1px solid #26323d;padding-top:12px}
.drillHead{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px}
.drillTitle{font-size:15px;font-weight:900}.drillSub{font-size:10px;color:#8d9aa6;margin-top:2px}
.drillClose{border:1px solid #34424f;background:#121a21;color:#b7c1cb;border-radius:9px;min-width:42px;min-height:36px;padding:6px 10px;cursor:pointer}
.drillList{display:grid;gap:7px}
.drillItem{background:#121a21;border:1px solid #26323d;border-radius:11px;padding:10px}
.drillTop{display:flex;justify-content:space-between;align-items:baseline;gap:8px}.drillTop b{font-size:14px}.drillBadge{font-size:10px;color:#f4c85a}
.drillMeta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 10px;margin-top:7px;font-size:11px;color:#b7c1cb}
.drillMeta span{min-width:0;overflow-wrap:anywhere}.drillMeta strong{color:#e7edf3;font-weight:700}
.drillSectorBtn{appearance:none;width:100%;text-align:left;background:#121a21;color:inherit;border:1px solid #26323d;border-radius:11px;padding:10px;cursor:pointer}
.drillSectorBtn:focus-visible{outline:2px solid #f4c85a;outline-offset:2px}
.drillSectorBtn .drillTop{margin-bottom:4px}
@media(max-width:560px){
  .rotationRow{grid-template-columns:68px 36px 50px 50px 48px 1fr;font-size:11px;padding:8px 7px}
  .sectorCard{min-width:142px}
  .drillMeta{grid-template-columns:1fr}
}
</style>
<section id="moneyRotationSection">
  <div class="sectionHead">
    <div>
      <div class="sectionTitle">자산군 자금회전 · 상대강도</div>
      <div class="sub">돈의 발자국 조건은 유지 · 현재 RS와 단기 가속도로 이동 방향 표시</div>
    </div>
    <div id="rotationLeader" class="pill">계산 중</div>
  </div>
  <div class="rotationPanel">
    <div id="rotationSummary" class="rotationSummary">자산군 회전 계산 중…</div>
    <div class="rotationGrid">
      <div class="rotationRow rotationHead"><b>자산군</b><span>순위</span><span>RS 1D</span><span>RS 5D</span><span>가속</span><span>단계</span></div>
      <div id="rotationRows"></div>
    </div>
    <div class="sectorFlow" id="sectorRotation"><div>섹터 회전 계산 중…</div></div>
    <div class="drillHint">자산군 행 또는 섹터 카드를 누르면 내부 자산을 펼쳐봅니다.</div>
    <div id="rotationDrilldown" class="rotationDrilldown" hidden></div>
  </div>
</section>
<script id="gn-rotation-script-v1">(function(){
const $=id=>document.getElementById(id),num=v=>Number(v),f=v=>Number.isFinite(num(v))?num(v).toFixed(1):'--',
esc=v=>String(v==null?'':v).replace(/[&<>\\\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\\\"':'&quot;',"'":'&#39;'}[c]));
const names={CRYPTO:'크립토',STOCK:'미국주식',GOLD:'금',COMMODITY:'원자재',BOND:'채권',CASH:'현금'};
const stages={LEADING_ACCELERATING:'선두·가속',LEADING:'선두',STRENGTHENING:'강화',WEAKENING:'약화',DEFENSIVE:'방어',NEUTRAL:'중립'};
const sectorNames={Technology:'기술/AI',Energy:'에너지',Communication:'커뮤니케이션',Consumer_Discretionary:'경기소비재',Consumer_Staples:'필수소비재',Healthcare:'헬스케어',Financials:'금융',Materials:'소재',Industrials:'산업재',Real_Estate:'부동산',Utilities:'유틸리티'};
let lastData=null,selection=null;
function cls(v){return num(v)>1?'rotUp':num(v)<-1?'rotDown':'rotFlat'}
function arrow(v){return num(v)>1?'↑':num(v)<-1?'↓':'→'}
function money(v,venue){if(!Number.isFinite(num(v)))return '--';const n=num(v);if(venue==='UPBIT'||n>=10000)return Math.round(n).toLocaleString('ko-KR')+'원';return '$'+n.toLocaleString('en-US',{maximumFractionDigits:2});}
function score(v){return Number.isFinite(num(v))?num(v).toFixed(1):'--'}
function actionKo(v){return ({LEADER:'선두',WATCH:'관찰',DEFENSIVE:'방어',MAINTENANCE:'검증 대기',ENTRY:'진입',SCOUT:'탐지',WAIT:'대기',NO_CHASE:'추격금지'})[v]||v||'--'}
function sectorLabel(s){return sectorNames[s]||String(s||'').replaceAll('_',' ')}
function repCard(r,title){
  if(!r)return '<div class="drillItem"><div class="drillTop"><b>'+esc(title||'대표 자산')+'</b><span class="drillBadge">데이터 없음</span></div></div>';
  return '<div class="drillItem"><div class="drillTop"><b>'+esc(r.symbol||title||'--')+'</b><span class="drillBadge">'+esc(actionKo(r.action))+'</span></div>'+
  '<div class="drillMeta"><span>현재가 <strong>'+esc(money(r.price,r.venue))+'</strong></span><span>종합점수 <strong>'+score(r.total_score)+'</strong></span>'+
  '<span>자금흐름 <strong>'+score(r.flow_score)+'</strong></span><span>상대강도 <strong>'+score(r.relative_strength)+'</strong></span>'+
  '<span>기술점수 <strong>'+score(r.technical_score)+'</strong></span><span>데이터품질 <strong>'+score(r.data_quality)+'</strong></span></div></div>';
}
function uniqueCrypto(rows){
  const seen=new Set(),out=[];
  for(const x of rows||[]){const k=x.market||'';if(!k||seen.has(k))continue;seen.add(k);out.push(x);if(out.length>=6)break;}
  return out;
}
function renderSector(sector){
  const d=lastData||{},rot=(d.sectors||[]).find(x=>x.sector===sector),rep=(d.stockRepresentatives||[]).find(x=>x.sector===sector);
  $('rotationDrilldown').innerHTML='<div class="drillHead"><div><div class="drillTitle">'+esc(sectorLabel(sector))+' 섹터</div>'+
  '<div class="drillSub">섹터 회전 + 현재 대표 선수</div></div><button type="button" class="drillClose" data-close-drill aria-label="상세 닫기">닫기</button></div>'+
  '<div class="drillList">'+
  '<div class="drillItem"><div class="drillTop"><b>섹터 흐름</b><span class="drillBadge">'+esc(stages[rot?.flow_stage]||rot?.flow_stage||'--')+'</span></div>'+
  '<div class="drillMeta"><span>순위 <strong>'+esc(rot?.rank??'--')+'</strong></span><span>RS 1D <strong>'+f(rot?.rs_1d)+'</strong></span>'+
  '<span>RS 5D <strong>'+f(rot?.rs_5d)+'</strong></span><span>가속 <strong class="'+cls(rot?.flow_acceleration)+'">'+arrow(rot?.flow_acceleration)+' '+f(Math.abs(num(rot?.flow_acceleration)))+'</strong></span></div></div>'+
  repCard(rep,'대표 선수')+'</div>';
  $('rotationDrilldown').hidden=false;
}
function renderAsset(asset){
  const d=lastData||{},rep=(d.representatives||[]).find(x=>x.asset_class===asset);
  let body='';
  if(asset==='STOCK'){
    const rows=(d.sectors||[]).filter(x=>x.asset_class==='STOCK');
    body='<div class="drillList">'+rows.map(x=>{
      const r=(d.stockRepresentatives||[]).find(y=>y.sector===x.sector);
      return '<button type="button" class="drillSectorBtn" data-sector="'+esc(x.sector)+'"><div class="drillTop"><b>'+esc(sectorLabel(x.sector))+'</b><span class="drillBadge">#'+esc(x.rank)+' '+esc(stages[x.flow_stage]||x.flow_stage||'')+'</span></div>'+
      '<div class="drillMeta"><span>대표 <strong>'+esc(r?.symbol||'--')+'</strong></span><span>현재가 <strong>'+esc(r?money(r.price,r.venue):'--')+'</strong></span>'+
      '<span>RS 1D <strong>'+f(x.rs_1d)+'</strong></span><span>가속 <strong class="'+cls(x.flow_acceleration)+'">'+arrow(x.flow_acceleration)+' '+f(Math.abs(num(x.flow_acceleration)))+'</strong></span></div></button>';
    }).join('')+'</div>';
  }else if(asset==='CRYPTO'){
    const crypto=uniqueCrypto(d.cryptoCandidates||[]);
    body='<div class="drillList">'+repCard(rep,'크립토 대표')+
    (crypto.length?crypto.map(x=>'<div class="drillItem"><div class="drillTop"><b>'+esc(String(x.market||'').replace(/^KRW-/,''))+'</b><span class="drillBadge">'+esc(actionKo(x.status))+'</span></div>'+
    '<div class="drillMeta"><span>현재가 <strong>'+esc(money(x.krw_price,'UPBIT'))+'</strong></span><span>점수 <strong>'+score(x.score)+'</strong></span>'+
    '<span>탐지가 <strong>'+esc(money(x.first_detected_price,'UPBIT'))+'</strong></span><span>추천진입 <strong>'+esc(Number.isFinite(num(x.recommended_entry_low))&&num(x.recommended_entry_low)>0?money(x.recommended_entry_low,'UPBIT')+'~'+money(x.recommended_entry_high,'UPBIT'):'승인 대기')+'</strong></span>'+
    '<span>해외지지 <strong>'+esc(money(x.foreign_support_krw,'UPBIT'))+'</strong></span><span>상장위험 <strong>'+esc(x.listing_risk||'--')+'</strong></span></div></div>').join(''):'<div class="drillItem">현재 크립토 후보 데이터 없음</div>')+'</div>';
  }else{
    body='<div class="drillList">'+repCard(rep,names[asset]||asset)+'</div>';
  }
  $('rotationDrilldown').innerHTML='<div class="drillHead"><div><div class="drillTitle">'+esc(names[asset]||asset)+' 내부 보기</div>'+
  '<div class="drillSub">'+(asset==='STOCK'?'섹터를 누르면 대표 종목 상세까지 이동':'현재 대표 자산과 검증 가능한 내부 후보')+'</div></div>'+
  '<button type="button" class="drillClose" data-close-drill aria-label="상세 닫기">닫기</button></div>'+body;
  $('rotationDrilldown').hidden=false;
}
function markSelection(){
  document.querySelectorAll('#moneyRotationSection [data-asset],#moneyRotationSection [data-sector]').forEach(el=>el.classList.remove('isActive'));
  if(!selection)return;
  const attr=selection.type==='asset'?'data-asset':'data-sector';
  document.querySelectorAll('#moneyRotationSection ['+attr+']').forEach(el=>{if(el.getAttribute(attr)===selection.key)el.classList.add('isActive')});
}
function renderSelection(){if(!selection||!lastData)return;if(selection.type==='asset')renderAsset(selection.key);else renderSector(selection.key);markSelection();}
async function loadRotation(){
  try{
    const r=await fetch('/api/rotation/latest?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);
    const d=await r.json(),s=d.summary||{},rows=d.assets||[];lastData=d;
    $('rotationLeader').textContent='선두 '+(names[s.leader_asset]||s.leader_asset||'--');
    $('rotationSummary').textContent=s.rotation_summary&&s.rotation_summary!=='뚜렷한 자산군 회전 없음'?(names[s.rotation_from]||s.rotation_from)+' ↓ → '+(names[s.rotation_to]||s.rotation_to)+' ↑':'뚜렷한 자산군 이동 없음';
    $('rotationRows').innerHTML=rows.map(x=>'<button type="button" class="rotationRow" data-asset="'+esc(x.asset_class)+'" aria-label="'+esc(names[x.asset_class]||x.asset_class)+' 내부 보기"><b>'+esc(names[x.asset_class]||x.asset_class)+'</b>'+
    '<span>'+esc(x.rank)+(num(x.rank_change)>0?' ↑'+x.rank_change:num(x.rank_change)<0?' ↓'+Math.abs(x.rank_change):'')+'</span><span>'+f(x.rs_1d)+'</span><span>'+f(x.rs_5d)+'</span>'+
    '<span class="'+cls(x.flow_acceleration)+'">'+arrow(x.flow_acceleration)+' '+f(Math.abs(num(x.flow_acceleration)))+'</span><span class="'+cls(x.flow_acceleration)+'">'+esc(stages[x.flow_stage]||x.flow_stage||'--')+'</span></button>').join('');
    $('sectorRotation').innerHTML=(d.sectors||[]).filter(x=>x.asset_class==='STOCK').map(x=>'<button type="button" class="sectorCard" data-sector="'+esc(x.sector)+'" aria-label="'+esc(sectorLabel(x.sector))+' 섹터 상세 보기"><b>'+esc(sectorLabel(x.sector))+'</b>'+
    '<small>순위 '+esc(x.rank)+' · RS1D '+f(x.rs_1d)+' · RS5D '+f(x.rs_5d)+'</small><small class="'+cls(x.flow_acceleration)+'">'+arrow(x.flow_acceleration)+' 가속 '+f(Math.abs(num(x.flow_acceleration)))+' · '+esc(stages[x.flow_stage]||x.flow_stage||'')+'</small></button>').join('')||'<div>섹터 데이터 없음</div>';
    renderSelection();
  }catch(e){if($('rotationSummary'))$('rotationSummary').textContent='자금회전 데이터 재조회 중';}
}
const root=$('moneyRotationSection');
if(root&&!root.dataset.drillBound){
  root.dataset.drillBound='1';
  root.addEventListener('click',e=>{
    const close=e.target.closest('[data-close-drill]');if(close){selection=null;$('rotationDrilldown').hidden=true;$('rotationDrilldown').innerHTML='';markSelection();return;}
    const sector=e.target.closest('[data-sector]');if(sector&&root.contains(sector)){selection={type:'sector',key:sector.getAttribute('data-sector')};renderSelection();return;}
    const asset=e.target.closest('[data-asset]');if(asset&&root.contains(asset)){selection={type:'asset',key:asset.getAttribute('data-asset')};renderSelection();}
  });
}
setTimeout(loadRotation,200);setInterval(loadRotation,15000);window.loadRotation=loadRotation;
})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("<title>GN PIVOT</title>")||html.includes("gn-rotation-script-v1"))return html;
  const marker='<section><div class="sectionHead"><div><div class="sectionTitle">오늘의 대표 선수</div>';
  if(html.includes(marker))return html.replace(marker,BLOCK+marker);
  return html.replace("</body>",BLOCK+"</body>");
}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.get("/api/rotation/latest",rotationLatest);
  app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});
  return app;
}
Object.assign(wrappedExpress,previousExpress);require.cache[expressPath].exports=wrappedExpress;
