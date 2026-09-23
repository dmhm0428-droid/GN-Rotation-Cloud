"use strict";

const expressPath=require.resolve("express");
const previousExpress=require("express");

const SEASONAL_WATCH={
  windows:[
    {label:"Q1 환매창",months:[3],startDay:1,endDay:25,note:"3월 초~중순 집중"},
    {label:"Q2 환매창",months:[6],startDay:1,endDay:30,note:"6월 전월 감시"},
    {label:"Q3 환매창",months:[9],startDay:1,endDay:25,note:"9월 1~25일 집중"},
    {label:"Q4 환매창",months:[12,1],startDay:1,endDay:15,note:"12월~다음해 1월 초 연장"}
  ],
  march2026Reference:{
    BX:{headlineDayPct:-3.8,mar2Close:115.33,mar12Close:102.12,mar12Low:101.73,closeDrawdownPct:-11.45,intradayDrawdownPct:-11.79},
    ARES:{mar2Close:113.36,mar12Close:96.50,closeDrawdownPct:-14.87},
    note:"3월 3일은 사모신용 환매 뉴스와 동시에 중동/유가·인플레이션 우려로 S&P500 -0.94%가 겹쳐 전체 낙폭을 사모신용 단독 영향으로 볼 수 없음."
  }
};
function seasonalState(now=new Date()){
  const m=now.getUTCMonth()+1,d=now.getUTCDate();
  const current=SEASONAL_WATCH.windows.find(w=>w.months.includes(m)&&d>=w.startDay&&d<=w.endDay)||null;
  return {active:!!current,current,month:m,day:d,windows:SEASONAL_WATCH.windows,march2026Reference:SEASONAL_WATCH.march2026Reference};
}

const VERIFIED={
  asOf:"2026-09-23",
  privateCredit:{
    state:"CAUTION",
    label:"사모신용 경계 유지 · 환매 압력은 전분기보다 완화",
    apollo:{requestPct:14.7,priorPct:16.8,repurchaseCapPct:5,source:"Reuters 2026-09-22 / Apollo filing"},
    morganStanley:{requestPct:11.4,priorPct:11.6,repurchaseCapPct:5,source:"Reuters 2026-09-18"},
    bdcSoftware:{markedBelowCostPct:81,otherSectorsPct:40,nonAccrualPct:3.4,priorNonAccrualPct:2.5,source:"Reuters 2026-09-02"},
    interpretation:"소프트웨어 전체 매도 신호가 아니라, 레버리지·재융자 의존 기업에 더 큰 압박. 현금흐름과 재무여력이 있는 소프트웨어는 동일 충격 뒤 차별화 가능."
  },
  mndy:{
    ticker:"MNDY",
    company:"monday.com",
    sector:"기업용 소프트웨어 · AI Work Platform",
    quarter:"2026 Q2",
    revenueGrowthPct:22,
    operatingCashFlowM:55.4,
    adjustedFcfM:52.3,
    cashAndSecuritiesM:1072.755,
    fyRevenueGrowthGuideLowPct:19,
    fyRevenueGrowthGuideHighPct:20,
    fyAdjustedFcfLowM:280,
    fyAdjustedFcfHighM:290,
    aiArrNote:"AI 제품 ARR이 Q1 대비 2배, Q2 순증 ARR의 17%",
    source:"monday.com IR 2026-08-10 / SEC"
  }
};

async function yahooQuote(symbol){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),4500);
  try{
    const u=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
    const r=await fetch(u,{headers:{"user-agent":"Mozilla/5.0 GN-PIVOT/1.0","accept":"application/json"},signal:c.signal});
    if(!r.ok)throw Error(`HTTP ${r.status}`);
    const p=await r.json(),m=p?.chart?.result?.[0]?.meta||{};
    const price=Number(m.regularMarketPrice),prev=Number(m.chartPreviousClose??m.previousClose),changePct=(Number.isFinite(price)&&Number.isFinite(prev)&&prev!==0)?(price/prev-1)*100:null;
    return {price:Number.isFinite(price)?price:null,previousClose:Number.isFinite(prev)?prev:null,changePct:Number.isFinite(changePct)?changePct:null,tradedAt:m.regularMarketTime?new Date(m.regularMarketTime*1000).toISOString():null,source:"YAHOO_FINANCE_CHART"};
  }catch(e){
    return {price:null,previousClose:null,changePct:null,tradedAt:null,source:"UNAVAILABLE",error:String(e?.name==="AbortError"?"QUOTE_TIMEOUT":e?.message||e)};
  }finally{clearTimeout(timer)}
}

function qualityState(m){
  const pass=m.revenueGrowthPct>=15&&m.operatingCashFlowM>0&&m.adjustedFcfM>0&&m.cashAndSecuritiesM>=500&&m.fyRevenueGrowthGuideLowPct>=15&&m.fyAdjustedFcfLowM>0;
  return {pass,label:pass?"FUNDAMENTALS_PASS":"FUNDAMENTALS_REVIEW"};
}
function priceState(mndy,igv,q){
  if(!q.pass)return {stage:"WAIT",label:"실적/현금흐름 재검증",reason:"펀더멘털 게이트 미통과"};
  const md=Number(mndy?.changePct),sd=Number(igv?.changePct);
  if(Number.isFinite(md)&&Number.isFinite(sd)&&md<=-3&&sd<=-1.5)return {stage:"READY",label:"QUALITY DIP 감시",reason:"소프트웨어 동반하락 + MNDY 낙폭 확대. 기업고유 악재·가이던스 훼손이 없을 때만 추매 후보."};
  if(Number.isFinite(md)&&md<=-3)return {stage:"PREP",label:"개별 급락 원인 확인",reason:"섹터 동반하락 확인 전. 기업고유 악재 여부를 먼저 확인."};
  return {stage:"PREP",label:"가격 충격 대기",reason:"펀더멘털은 통과. 추격보다 섹터성 조정에서 가격기회 감시."};
}
async function api(req,res){
  const [mndy,igv]=await Promise.all([yahooQuote("MNDY"),yahooQuote("IGV")]);
  const quality=qualityState(VERIFIED.mndy),price=priceState(mndy,igv,quality);
  res.set("Cache-Control","no-store");
  res.json({ts:new Date().toISOString(),verified:VERIFIED,seasonalWatch:seasonalState(),quality,price,quotes:{MNDY:mndy,IGV:igv},rules:{
    addOnGate:["매출 성장 유지(기본 15%+)","영업현금흐름 양수","FCF 양수","현금·유가증권 충분","연간 가이던스 유지","섹터 동반하락 확인"],
    invalidation:["매출 성장/가이던스 급격한 하향","영업현금흐름 또는 FCF 음전","순현금 급감·외부차입 의존 상승","기업고유 회계·수요·제품 경쟁력 악재"]
  }});
}

const STYLE=`<style id="gn-private-credit-quality-style">
#gnPrivateCreditQuality{margin:14px 0;padding:14px;border:1px solid #354352;border-radius:16px;background:#0f141a;color:#eef3f7}
#gnPrivateCreditQuality .head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
#gnPrivateCreditQuality .title{font-size:17px;font-weight:950}.stage{font-size:24px;font-weight:950;margin-top:4px}
#gnPrivateCreditQuality .muted{font-size:11px;color:#8996a3}.line{font-size:12px;color:#b7c2cc;line-height:1.55;margin-top:5px}
#gnPrivateCreditQuality .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:11px}
#gnPrivateCreditQuality .card{padding:11px;border:1px solid #293540;border-radius:12px;background:#121920}
#gnPrivateCreditQuality .card b{font-size:13px}.value{font-size:18px;font-weight:900;margin-top:4px}
#gnPrivateCreditQuality .good{color:#5ada91}.warn{color:#ffd166}.bad{color:#ff7272}
#gnPrivateCreditQuality .gates{margin-top:10px;padding-top:9px;border-top:1px solid #28333d;font-size:11px;line-height:1.6;color:#aeb8c2}
@media(max-width:620px){#gnPrivateCreditQuality .grid{grid-template-columns:1fr}}
</style>`;

const SCRIPT=`<script id="gn-private-credit-quality-v1">(function(){
function esc(v){return String(v==null?'':v).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function n(v,d){var x=Number(v);return Number.isFinite(x)?x.toFixed(d==null?1:d):'--'}
function usd(v){var x=Number(v);return Number.isFinite(x)?'$'+x.toFixed(2):'--'}
function mount(){if(document.getElementById('gnPrivateCreditQuality'))return;var box=document.createElement('section');box.id='gnPrivateCreditQuality';box.innerHTML='<div class="head"><div><div class="title">사모신용 스트레스 → 질적 성장주 추매 필터</div><div class="stage" id="pcqStage">불러오는 중</div><div class="line" id="pcqLine">실적·성장·현금흐름과 섹터 동반하락을 함께 확인</div></div><div class="muted">PRIVATE CREDIT / SOFTWARE QUALITY</div></div><div class="grid"><div class="card" id="pcqCredit"></div><div class="card" id="pcqMndy"></div></div><div class="gates" id="pcqGates"></div>';var anchor=document.getElementById('gnInvestmentLink')||document.getElementById('gnBigPicture');if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(box,anchor.nextSibling);else{var wrap=document.querySelector('.wrap')||document.querySelector('main')||document.body;wrap.insertBefore(box,wrap.firstChild)}}
async function load(){mount();try{var r=await fetch('/api/private-credit-quality?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);var d=await r.json(),v=d.verified||{},pc=v.privateCredit||{},m=v.mndy||{},q=d.quality||{},p=d.price||{},mq=(d.quotes||{}).MNDY||{},sq=(d.quotes||{}).IGV||{};var st=document.getElementById('pcqStage'),ln=document.getElementById('pcqLine');if(st){st.textContent=p.stage+' · '+p.label;st.className='stage '+(p.stage==='READY'?'good':p.stage==='WAIT'?'bad':'warn')}if(ln)ln.textContent=p.reason||'';var c=document.getElementById('pcqCredit');if(c){var sw=d.seasonalWatch||{},mr=sw.march2026Reference||{},bx=mr.BX||{},ar=mr.ARES||{},win=(sw.windows||[]).map(function(w){return w.label+' '+w.months.join('/')+'월 '+w.startDay+'~'+w.endDay+'일'}).join(' · ');c.innerHTML='<b>사모신용 위험</b><div class="value warn">'+esc(pc.label||'--')+'</div><div class="line">Apollo 환매요청 '+n(pc.apollo&&pc.apollo.requestPct)+'% (전분기 '+n(pc.apollo&&pc.apollo.priorPct)+'%) · 실제 환매한도 '+n(pc.apollo&&pc.apollo.repurchaseCapPct)+'%</div><div class="line">MS '+n(pc.morganStanley&&pc.morganStanley.requestPct)+'% · 소프트웨어 대출 장부가 이하 '+n(pc.bdcSoftware&&pc.bdcSoftware.markedBelowCostPct)+'% · 비수익대출 '+n(pc.bdcSoftware&&pc.bdcSoftware.nonAccrualPct)+'%</div><div class="line '+(sw.active?'warn':'')+'"><b>분기 환매 감시창</b> · '+(sw.active?('현재 진입 · '+esc(sw.current&&sw.current.label)):'현재 비활성')+'</div><div class="muted">'+esc(win)+'</div><div class="line">2026년 3월 참고 · BX 뉴스당일 '+n(bx.headlineDayPct)+'% · 3/2→3/12 종가 '+n(bx.closeDrawdownPct)+'% · ARES '+n(ar.closeDrawdownPct)+'%</div><div class="muted" style="margin-top:6px">'+esc(mr.note||'')+'</div><div class="muted" style="margin-top:6px">'+esc(pc.interpretation||'')+'</div>';}var x=document.getElementById('pcqMndy');if(x)x.innerHTML='<b>MNDY 펀더멘털 게이트</b><div class="value '+(q.pass?'good':'bad')+'">'+esc(q.label||'--')+'</div><div class="line">현재 '+usd(mq.price)+' · 일간 '+n(mq.changePct)+'% · IGV '+n(sq.changePct)+'%</div><div class="line">매출 +'+n(m.revenueGrowthPct)+'% · OCF $'+n(m.operatingCashFlowM)+'M · 조정 FCF $'+n(m.adjustedFcfM)+'M</div><div class="line">현금+유가증권 $'+n(m.cashAndSecuritiesM/1000,3)+'B · 연간 매출 가이던스 +'+n(m.fyRevenueGrowthGuideLowPct,0)+'~'+n(m.fyRevenueGrowthGuideHighPct,0)+'%</div><div class="muted" style="margin-top:6px">'+esc(m.aiArrNote||'')+'</div>';var g=document.getElementById('pcqGates'),rules=d.rules||{};if(g)g.innerHTML='<b>추매 조건</b> · '+(rules.addOnGate||[]).map(esc).join(' → ')+'<br><b>무효화</b> · '+(rules.invalidation||[]).map(esc).join(' · ')+'<br><span class="muted">핵심: 섹터 전체가 먼저 밀려도 실적·성장·현금흐름이 유지되는 기업은 별도 추적. 가격 하락만으로 ACTION 처리하지 않음.</span>';}catch(e){var st=document.getElementById('pcqStage');if(st)st.textContent='재조회 중';}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){mount();load()});else{mount();load()}setInterval(load,60000);window.gnPrivateCreditQuality=load;
})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("gn-private-credit-quality-v1"))return html;
  let out=html;
  if(out.includes("</head>"))out=out.replace("</head>",STYLE+"</head>");
  return out.replace("</body>",SCRIPT+"</body>");
}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.get("/api/private-credit-quality",api);
  app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
