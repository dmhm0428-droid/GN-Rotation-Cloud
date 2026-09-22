"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");

const SECTORS=[
  {id:"quantum",name:"양자",etf:{code:"0023A0",name:"SOL 미국양자컴퓨팅TOP10"},reps:["IONQ","QBTS","RGTI","QUBT"]},
  {id:"optical",name:"AI 광통신",etf:{code:"0173Y0",name:"KODEX 미국AI광통신네트워크"},reps:["COHR","LITE","MRVL","AVGO"]},
  {id:"power-kodex",name:"AI 전력·냉각",etf:{code:"487230",name:"KODEX 미국AI전력핵심인프라"},reps:["VRT","GEV","ETN","PWR"]},
  {id:"power-tiger",name:"AI 전력·원전",etf:{code:"491010",name:"TIGER 글로벌AI전력인프라액티브"},reps:["BE","VRT","GEV","CCJ"]},
  {id:"defense",name:"방산",etf:{code:"449450",name:"PLUS K방산"},reps:["012450.KS","079550.KS","047810.KS","272210.KS"]},
  {id:"semi",name:"반도체·HBM",etf:null,reps:["000660.KS","MU","NVDA","AVGO"]},
  {id:"cyber",name:"사이버보안",etf:null,reps:["CRWD","PANW","FTNT","OKTA"]},
  {id:"space",name:"우주",etf:null,reps:["RKLB","LUNR","PL","RDW"]},
  {id:"smr",name:"SMR·원전",etf:null,reps:["OKLO","SMR","CCJ","BWXT"]},
  {id:"usd-short",name:"달러·미국단기채",etf:{code:"329750",name:"TIGER 미국달러단기채권액티브"},reps:["SGOV","BIL","SHY"]},
  {id:"sp500",name:"미국 S&P500",etf:{code:"360750",name:"TIGER 미국S&P500"},reps:["SPY","NVDA","MSFT","AVGO"]}
];

const EVENTS=[
  {date:"2026-09-23",end:"2026-09-25",sectorIds:["quantum"],label:"Quantum World Congress",watch:"IONQ·QBTS·RGTI 기술·계약·정부수요"},
  {date:"2026-09-20",end:"2026-09-24",sectorIds:["optical"],label:"ECOC 2026",watch:"800G·1.6T·CPO/NPO·광트랜시버"},
  {date:"2026-09-28",end:"2026-09-30",sectorIds:["power-kodex","power-tiger","smr"],label:"IAEA SMR·데이터센터 전력/냉각 회의",watch:"AI 데이터센터 전력 병목·SMR·냉각"},
  {date:"2026-09-30",sectorIds:["semi"],label:"Micron 실적",watch:"HBM 가격·AI 서버 수요·CAPEX"},
  {date:"2026-09-30",sectorIds:["quantum","optical","power-kodex","power-tiger","semi","cyber","space","smr","usd-short","sp500"],label:"미국 PCE·GDP",watch:"물가·성장률→2Y/10Y·DXY·원달러·성장주/채권"},
  {date:"2026-10-02",sectorIds:["quantum","optical","power-kodex","power-tiger","semi","cyber","space","smr","usd-short","sp500"],label:"미국 고용보고서",watch:"고용→Fed 경로·2Y·달러·S&P500"},
  {date:"2026-10-04",sectorIds:["power-kodex","power-tiger","semi","quantum","optical","sp500"],label:"OPEC+",watch:"유가→물가→금리→고밸류 성장주"},
  {date:"2026-10-07",sectorIds:["quantum","optical","power-kodex","power-tiger","semi","cyber","space","smr","usd-short","sp500"],label:"9월 FOMC 의사록",watch:"추가 긴축/완화 경로·2Y/10Y·달러"},
  {date:"2026-10-05",end:"2026-10-09",sectorIds:["space"],label:"International Astronautical Congress",watch:"우주 발사·위성·정부 계약"},
  {date:"2026-10-08",sectorIds:["smr","power-tiger"],label:"Nuclear Roundtable",watch:"원전·SMR 발주/정책/금융"},
  {date:"2026-10-12",end:"2026-10-15",sectorIds:["power-kodex","power-tiger","optical","semi"],label:"OCP Global Summit",watch:"AI 전력·냉각·광통신·서버 인프라"},
  {date:"2026-10-12",end:"2026-10-14",sectorIds:["defense"],label:"AUSA",watch:"방산 수주·무기체계·국방 예산"},
  {date:"2026-10-14",sectorIds:["quantum","optical","power-kodex","power-tiger","semi","cyber","space","smr","usd-short","sp500"],label:"미국 CPI",watch:"금리·DXY·성장주 밸류에이션"}
];

let cache={at:0,data:null};
const TTL=10*60*1000;
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function sma(a,len){const x=a.filter(Number.isFinite);if(x.length<len)return null;const s=x.slice(-len);return s.reduce((p,c)=>p+c,0)/len;}
function pct(a,b){return a!=null&&b?((a/b)-1)*100:null;}
function daysTo(date){return Math.ceil((new Date(date+"T00:00:00Z").getTime()-Date.now())/86400000);}
async function fetchJson(url,timeout=6500){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);
  try{const r=await fetch(url,{signal:c.signal,headers:{accept:"application/json","user-agent":"Mozilla/5.0 GN-PIVOT/1.0"}});if(!r.ok)throw Error(`HTTP ${r.status}`);return await r.json();}
  finally{clearTimeout(timer);}
}
async function yahooSeries(symbol){
  try{
    const j=await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`);
    const r=j?.chart?.result?.[0];if(!r)throw Error("NO_SERIES");
    const meta=r.meta||{},q=r.indicators?.quote?.[0]||{},adj=r.indicators?.adjclose?.[0]?.adjclose||[];
    const closes=(adj.length?adj:q.close||[]).map(n).filter(Number.isFinite);
    const highs=(q.high||[]).map(n).filter(Number.isFinite);
    const price=n(meta.regularMarketPrice)??closes.at(-1)??null;
    const high52=highs.length?Math.max(...highs):null;
    return {symbol,price,ma20:sma(closes,20),ma50:sma(closes,50),ma60:sma(closes,60),ma120:sma(closes,120),ma200:sma(closes,200),high52,drawdownPct:pct(price,high52),source:"YAHOO"};
  }catch(e){return {symbol,price:null,error:String(e?.message||e),source:"UNAVAILABLE"};}
}
async function naverEtfCurrent(code){
  try{
    const j=await fetchJson(`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/basic`);
    return {price:n(String(j?.closePrice||"").replaceAll(",","")),name:j?.stockName||null,source:"NAVER"};
  }catch(e){return {price:null,error:String(e?.message||e),source:"UNAVAILABLE"};}
}
async function etfSeries(etf){
  if(!etf)return null;
  const y=await yahooSeries(`${etf.code}.KS`);
  const c=await naverEtfCurrent(etf.code);
  return {...y,code:etf.code,name:etf.name,price:c.price??y.price,currentSource:c.price!=null?c.source:y.source};
}
async function macro(){
  const [dxy,fx]=await Promise.all([yahooSeries("DX-Y.NYB"),yahooSeries("KRW=X")]);
  return {dxy:dxy.price,usdkrw:fx.price,fxChangePct:pct(fx.price,fx.ma20),fxMa20:fx.ma20,source:"YAHOO"};
}
function eventFor(id){
  const xs=EVENTS.filter(e=>e.sectorIds.includes(id)).map(e=>({...e,days:daysTo(e.date)})).filter(e=>e.days>=-2&&e.days<=21).sort((a,b)=>a.days-b.days);
  return xs[0]||null;
}
function classify(sec,macroData){
  const etf=sec.etfData||{}, reps=sec.representatives||[], valid=reps.filter(x=>x.price!=null);
  const dds=valid.map(x=>x.drawdownPct).filter(Number.isFinite);
  const avgDd=dds.length?dds.reduce((a,b)=>a+b,0)/dds.length:null;
  const above20=valid.filter(x=>x.ma20&&x.price>=x.ma20).length;
  const above50=valid.filter(x=>x.ma50&&x.price>=x.ma50).length;
  const above200=valid.filter(x=>x.ma200&&x.price>=x.ma200).length;
  const ev=sec.event; const eventSoon=ev&&ev.days>=0&&ev.days<=14;
  const etfNear20=etf?.price&&etf?.ma20?Math.abs((etf.price/etf.ma20)-1)<=0.035:false;
  const etfRecovery=etf?.price&&etf?.ma20&&etf?.ma60?etf.price>=etf.ma20&&etf.price<etf.ma60:true;
  const breadth50=valid.length?above50/valid.length:0;
  const breadth200=valid.length?above200/valid.length:0;
  const deeplyReset=avgDd!=null&&avgDd<=-25;
  const fxRisk=macroData?.usdkrw!=null&&macroData.usdkrw>=1380;
  const dxyRisk=macroData?.dxy!=null&&macroData.dxy>=103;
  let state="WAIT",reason="구조 확인 대기";
  if(eventSoon&&deeplyReset){state="PREP";reason="D-14 이내 이벤트 + 구성주 충분한 조정";}
  if(eventSoon&&deeplyReset&&breadth50>=0.5&&etfRecovery&&!fxRisk&&!dxyRisk){state="READY";reason="구성주 50일선 회복 + ETF 초기반등 + 매크로 과열 아님";}
  if(eventSoon&&deeplyReset&&breadth50>=0.5&&etfNear20&&!fxRisk&&!dxyRisk){state="ACTION";reason="이벤트 전 + ETF 20일선 근접 + 구성주 반등 확산";}
  if(etf?.price&&etf?.ma20&&etf.price>etf.ma20*1.08){state="WAIT";reason="20일선 대비 +8% 초과 · 추격구간";}
  if(fxRisk||dxyRisk){if(state==="ACTION")state="READY";reason+=(fxRisk?" · 원달러 1380+":"")+(dxyRisk?" · DXY 103+":"");}
  return {state,reason,avgDrawdownPct:avgDd,above20,above50,above200,validCount:valid.length,breadth50,breadth200};
}
async function build(){
  if(cache.data&&Date.now()-cache.at<TTL)return cache.data;
  const macroData=await macro();
  const rows=[];
  for(const s of SECTORS){
    const [etfData,...representatives]=await Promise.all([s.etf?etfSeries(s.etf):Promise.resolve(null),...s.reps.map(yahooSeries)]);
    const row={...s,etfData,representatives,event:eventFor(s.id)};
    row.signal=classify(row,macroData);rows.push(row);
  }
  const data={ts:new Date().toISOString(),macro:macroData,sectors:rows,thresholds:{fxWatch:1350,fxRisk:1380,dxyRisk:103,eventLeadDays:14,chaseOverMa20Pct:8},logic:"ETF 20/60/120일선 + 대표구성주 20/50/200일선/52주고점조정 + D-14 이벤트 + DXY/원달러 + 뉴스/악재 역검증. 2Y/10Y·유가·디젤은 /api/diesel-footprint, 뉴스는 /api/save-brief와 매시간 외부 교차검증 보고에서 결합."};
  cache={at:Date.now(),data};return data;
}

const STYLE=`<style id="gn-retirement-signal-style-v1">
#gnRetSignal{margin:14px 0;background:#0d1218;border:1px solid #2b3945;border-radius:14px;padding:14px;color:#e9eef3}.grsHead{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.grsTitle{font-weight:900;font-size:15px}.grsSub{font-size:10px;color:#8f9ca8;margin-top:4px;line-height:1.5}.grsMacro{display:grid;grid-template-columns:repeat(6,minmax(80px,1fr));gap:6px;margin-top:10px}.grsMacro>div,.grsRow{background:#111820;border:1px solid #25313c;border-radius:10px}.grsMacro>div{padding:8px}.grsL{font-size:9px;color:#7f8c98}.grsV{font-size:13px;font-weight:900;margin-top:3px}.grsRows{display:grid;gap:7px;margin-top:10px}.grsRow{padding:10px;display:grid;grid-template-columns:1.2fr .95fr 1.15fr 1.1fr;gap:8px;align-items:center}.grsName{font-weight:900}.grsMeta{font-size:10px;color:#91a0ad;line-height:1.45;margin-top:3px}.grsState{display:inline-block;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:900}.grsState.ACTION{background:#124d32;color:#8ff0ba}.grsState.READY{background:#143a5a;color:#9ed3ff}.grsState.PREP{background:#554313;color:#ffd96c}.grsState.WAIT{background:#3b3030;color:#ffb3b3}.grsEvt{font-size:10px;line-height:1.45}.grsReason{font-size:10px;color:#aeb8c2;line-height:1.45}.grsNews{margin-top:10px;background:#101820;border:1px solid #30404d;border-radius:10px;padding:10px}.grsNewsHead{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:11px;font-weight:900}.grsNewsBody{margin-top:6px;font-size:10px;color:#aeb8c2;line-height:1.5}.grsNews.bad{border-color:#6e3434}.grsNews.stale{opacity:.72}.grsNote{font-size:9px;color:#778693;margin-top:8px;line-height:1.5}@media(max-width:760px){.grsMacro{grid-template-columns:repeat(3,1fr)}.grsRow{grid-template-columns:1fr 1fr}.grsReason{grid-column:1/-1}}
</style>`;
const PANEL=`<section id="gnRetSignal"><div class="grsHead"><div><div class="grsTitle">퇴직연금 · 섹터 선행감시</div><div class="grsSub">평단 기준이 아니라 ETF 이평 · 구성주 조정/반등 · D-14 이벤트 · 금리/DXY/환율 · 유가/디젤을 결합</div></div><span id="grsOverall" class="grsState WAIT">계산중</span></div><div id="grsMacro" class="grsMacro"></div><div id="grsNews" class="grsNews"><div class="grsNewsHead"><span>뉴스·악재 검증</span><span>불러오는 중</span></div><div class="grsNewsBody">공시·IR·SEC·정부자료·Reuters/AP·SAVE 역검증</div></div><div id="grsRows" class="grsRows"></div><div class="grsNote">PREP=이벤트 전 조정구간 · READY=반등 구조 확인 · ACTION=20일선 근처 실행검토 · WAIT=추격/매크로 부담/구조 미확인. 실제 주문 전 가격·보유비중 확인.</div></section>`;
const SCRIPT=`<script id="gn-retirement-signal-ui-v1">(function(){
function n(v){var x=Number(v);return Number.isFinite(x)?x:null}function f(v,d){var x=n(v);return x==null?'--':x.toLocaleString('ko-KR',{maximumFractionDigits:d==null?2:d})}function p(v){var x=n(v);return x==null?'--':(x>=0?'+':'')+x.toFixed(1)+'%'}function esc(v){return String(v==null?'':v).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function eventText(e){if(!e)return '향후 21일 핵심 이벤트 없음';var d=Number(e.days),tag=d>0?'D-'+d:(d===0?'오늘':'진행/직후');return '<b>'+tag+'</b> '+esc(e.label)+'<div class="grsMeta">'+esc(e.watch||'')+'</div>'}
function renderNews(s){var box=document.getElementById('grsNews');if(!box)return;s=s||{};var ts=s.ts?new Date(s.ts).getTime():NaN,age=Number.isFinite(ts)?(Date.now()-ts)/3600000:999,stale=age>2,verified=Array.isArray(s.verified)?s.verified:[],state=s.conflict?'충돌':(stale?'오래됨':(s.saveChecked?'검증됨':'미검증'));box.className='grsNews '+(s.conflict?'bad':(stale?'stale':''));var lines=verified.slice(0,3).map(function(x){return '<div><b>'+esc(x.topic||'시장')+'</b> · '+esc(x.fact||'')+'<br><span class="grsMeta">'+esc(x.validation||'교차검증 대기')+'</span></div>'}).join('');box.innerHTML='<div class="grsNewsHead"><span>뉴스·악재 검증</span><span>'+esc(state)+'</span></div><div class="grsNewsBody">'+(lines||esc(s.summary||'새 검증 뉴스 없음'))+(stale?'<div class="grsMeta">2시간 초과 자료는 ACTION 판정 근거에서 제외</div>':'')+'</div>'}
function render(a,d,s){var m=a.macro||{},df=d||{},y2=df.us2y||{},y10=df.us10y||{},w=df.wti||{},rd=df.retail||{};var mg=document.getElementById('grsMacro'),rows=document.getElementById('grsRows'),ov=document.getElementById('grsOverall');if(!mg||!rows||!ov)return;renderNews(s);mg.innerHTML=[['미국2Y',f(y2.yieldPct,2)+'%'],['미국10Y',f(y10.yieldPct,2)+'%'],['DXY',f(m.dxy,2)],['원/달러',f(m.usdkrw,1)+'원'],['WTI','$'+f(w.price,2)],['디젤','$'+f(rd.price,3)+'/gal']].map(function(x){return '<div><div class="grsL">'+x[0]+'</div><div class="grsV">'+x[1]+'</div></div>'}).join('');var rank={ACTION:4,READY:3,PREP:2,WAIT:1},best='WAIT';rows.innerHTML=(a.sectors||[]).map(function(s){var e=s.etfData||{},g=s.signal||{};if(rank[g.state]>rank[best])best=g.state;var ma=e.price?('현재 '+f(e.price,0)+(e.ma20?' · 20D '+f(e.ma20,0):'')+(e.ma60?' · 60D '+f(e.ma60,0):'')+(e.ma120?' · 120D '+f(e.ma120,0):'')):'관심섹터 · ETF 미지정';var b=(g.validCount||0)?('구성주 평균고점대비 '+p(g.avgDrawdownPct)+' · 50D위 '+g.above50+'/'+g.validCount+' · 200D위 '+g.above200+'/'+g.validCount):'구성주 데이터 대기';return '<div class="grsRow"><div><div class="grsName">'+esc(s.name)+'</div><div class="grsMeta">'+esc(s.etf? s.etf.name:'관심섹터')+'</div></div><div><span class="grsState '+esc(g.state||'WAIT')+'">'+esc(g.state||'WAIT')+'</span><div class="grsMeta">'+ma+'</div></div><div class="grsEvt">'+eventText(s.event)+'</div><div class="grsReason">'+esc(g.reason||'')+'<div class="grsMeta">'+b+'</div></div></div>'}).join('');ov.className='grsState '+best;ov.textContent='최고단계 '+best;}
async function load(){try{var r=await Promise.all([fetch('/api/retirement-signal?t='+Date.now(),{cache:'no-store'}),fetch('/api/diesel-footprint?t='+Date.now(),{cache:'no-store'}),fetch('/api/save-brief?t='+Date.now(),{cache:'no-store'})]);if(!r[0].ok)throw Error('signal '+r[0].status);render(await r[0].json(),r[1].ok?await r[1].json():{},r[2].ok?await r[2].json():{})}catch(e){var ov=document.getElementById('grsOverall');if(ov){ov.className='grsState WAIT';ov.textContent='데이터 재연결'}}}load();setInterval(load,60000);})();</script>`;
function patchHtml(html){
  if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("gnRetSignal"))return html;
  let out=html.replace("</head>",STYLE+"</head>");
  const marker='<section id="gnDieselFootprint">';
  if(out.includes(marker))out=out.replace(marker,PANEL+marker);
  else if(out.includes('<div class="tabs">'))out=out.replace('<div class="tabs">',PANEL+'<div class="tabs">');
  else out=out.replace("</body>",PANEL+"</body>");
  return out.replace("</body>",SCRIPT+"</body>");
}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.get("/api/retirement-signal",async(req,res)=>{try{res.set("Cache-Control","no-store");res.json(await build());}catch(e){res.status(500).json({error:String(e?.message||e)});}});
  app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body));};next();});
  return app;
}
Object.assign(wrappedExpress,previousExpress);require.cache[expressPath].exports=wrappedExpress;
module.exports={build,classify,SECTORS,EVENTS};
