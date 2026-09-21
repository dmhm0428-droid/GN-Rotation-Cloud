"use strict";

const expressPath=require.resolve("express");
const previousExpress=require("express");

const TTL_MS=5*60*1000;
let cache={at:0,data:null};

// S&P Global Ratings latest U.S. maturity schedule (USD bn).
// Includes rated bonds, loans and revolving facilities; this is the broad maturity wall,
// not a claim that every dollar is specifically a 3Y/5Y bond.
const MATURITY_WALL=[
  {year:2026,totalBn:907.6,specNonfinBn:142.3},
  {year:2027,totalBn:1117.6,specNonfinBn:246.6},
  {year:2028,totalBn:1464.6,specNonfinBn:551.3},
  {year:2029,totalBn:1332.0,specNonfinBn:533.0},
  {year:2030,totalBn:1256.7,specNonfinBn:416.3}
];

const n=v=>Number.isFinite(Number(v))?Number(v):null;
function pct(a,b){
  const x=n(a),y=n(b);
  if(x==null||y==null||y===0)return null;
  return +((x/y-1)*100).toFixed(2);
}
function avg(rows,start,end){
  const vals=rows.slice(start,end).map(x=>n(x.close)).filter(Number.isFinite);
  return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
}
async function fetchText(url,timeout=8000){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);
  try{
    const r=await fetch(url,{signal:c.signal,headers:{"user-agent":"Mozilla/5.0 GN-PIVOT/1.0","accept":"text/csv,text/plain,*/*"}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return await r.text();
  }finally{clearTimeout(timer);}
}
async function fetchJson(url,timeout=8000){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);
  try{
    const r=await fetch(url,{signal:c.signal,headers:{"user-agent":"Mozilla/5.0 GN-PIVOT/1.0","accept":"application/json"}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }finally{clearTimeout(timer);}
}
async function yahooSeries(symbol,range="6mo",interval="1d"){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const j=await fetchJson(url);
  const x=j?.chart?.result?.[0];
  if(!x)throw new Error(`Yahoo empty ${symbol}`);
  const closes=x.indicators?.quote?.[0]?.close||[],ts=x.timestamp||[];
  const rows=closes.map((close,i)=>({ts:Number(ts[i])*1000,close:n(close)})).filter(r=>Number.isFinite(r.ts)&&r.close!=null);
  if(rows.length<2)throw new Error(`Yahoo insufficient ${symbol}`);
  const last=rows.at(-1),prev=rows.at(-2),p5=rows[Math.max(0,rows.length-6)],p20=rows[Math.max(0,rows.length-21)];
  return {
    symbol,
    price:last.close,
    tradedAt:new Date(last.ts).toISOString(),
    chg1dPct:pct(last.close,prev.close),
    chg5dPct:pct(last.close,p5.close),
    chg20dPct:pct(last.close,p20.close),
    rows,
    source:"Yahoo Finance chart"
  };
}
function parseFred(csv){
  const lines=String(csv||"").trim().split(/\r?\n/).slice(1);
  const rows=[];
  for(const line of lines){
    const i=line.indexOf(",");
    if(i<0)continue;
    const date=line.slice(0,i).trim(),value=n(line.slice(i+1).trim());
    if(!date||value==null)continue;
    rows.push({date,value});
  }
  return rows;
}
async function fredDiesel(){
  const d=new Date();d.setUTCFullYear(d.getUTCFullYear()-1);
  const cosd=d.toISOString().slice(0,10);
  const csv=await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW&cosd=${cosd}`);
  const rows=parseFred(csv);
  if(rows.length<2)throw new Error("FRED GASDESW insufficient");
  const last=rows.at(-1),prev=rows.at(-2),p4=rows[Math.max(0,rows.length-5)];
  return {
    price:last.value,
    asOf:last.date,
    wowPct:pct(last.value,prev.value),
    fourWeekPct:pct(last.value,p4.value),
    source:"FRED GASDESW · U.S. On-Highway Diesel Fuel Price"
  };
}
async function fredMarketSeries(id,lookbackDays=180){
  const d=new Date(Date.now()-lookbackDays*86400000),cosd=d.toISOString().slice(0,10);
  const csv=await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${cosd}`);
  const rows=parseFred(csv);
  if(rows.length<2)throw new Error(`FRED ${id} insufficient`);
  const last=rows.at(-1),p5=rows[Math.max(0,rows.length-6)],p20=rows[Math.max(0,rows.length-21)];
  return {
    id,value:last.value,asOf:last.date,
    chg5dBp:+((last.value-p5.value)*100).toFixed(1),
    chg20dBp:+((last.value-p20.value)*100).toFixed(1),
    source:`FRED ${id}`
  };
}
function detectShockAnchor(rows){
  if(!Array.isArray(rows)||rows.length<25)return {detected:false,date:rows?.at(-1)?.ts?new Date(rows.at(-1).ts):new Date(),reason:"현재월 기준"};
  const cutoff=Date.now()-60*86400000;
  for(let i=Math.max(20,rows.length-60);i<rows.length;i++){
    if(rows[i].ts<cutoff)continue;
    const mean20=avg(rows,i-20,i),r5=i>=5?pct(rows[i].close,rows[i-5].close):null;
    const premium=mean20?pct(rows[i].close,mean20):null;
    if(r5!=null&&premium!=null&&r5>=7&&premium>=10){
      return {detected:true,date:new Date(rows[i].ts),reason:`ULSD 5일 +${r5.toFixed(1)}% · 20일평균 대비 +${premium.toFixed(1)}%`};
    }
  }
  return {detected:false,date:new Date(rows.at(-1).ts),reason:"강한 신규 충격 미검출 · 현재월 기준 감시"};
}
function addMonths(date,m){
  const d=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+m,1));
  return d;
}
function monthText(d){return `${d.getUTCFullYear()}년 ${d.getUTCMonth()+1}월`;}
function windowText(anchor,a,b){
  const x=monthText(addMonths(anchor,a)),y=monthText(addMonths(anchor,b));
  return x===y?x:`${x} ~ ${y}`;
}
function buildTimeline(anchor){
  return [
    {lag:"0~1개월",window:windowText(anchor,0,1),macro:"정제마진·운임·기업 구매가",credit:"HY 스프레드 선행 확대 여부",market:"고베타·AI 변동성 먼저 확인"},
    {lag:"1~2개월",window:windowText(anchor,1,2),macro:"PPI 운송·도매 원가",credit:"2Y 상승·추가긴축 기대 재가격",market:"AI·크립토 밸류에이션 압박"},
    {lag:"2~4개월",window:windowText(anchor,2,4),macro:"CPI·PCE 운송/상품/서비스",credit:"2Y·10Y 고착 → 신규 차환쿠폰 상승",market:"AI CAPEX·레버리지 취약주 압박"},
    {lag:"3~6개월",window:windowText(anchor,3,6),macro:"기업마진·기대인플레·10Y",credit:"HY OAS + 차환비용 동시상승 여부",market:"위험자산 전반 되돌림 경계"},
    {lag:"6~12개월",window:windowText(anchor,6,12),macro:"고금리 누적효과",credit:"2027 만기벽·조기차환 창구 점검",market:"신용 선별·부도율·AI 투자속도"},
    {lag:"12~24개월",window:windowText(anchor,12,24),macro:"고금리 지속 여부가 핵심",credit:"2028 미국 만기벽 집중구간",market:"금리가 높게 남으면 차환 스트레스 증폭"}
  ];
}
function creditSignal(us2y,hy){
  const y2=n(us2y?.chg5dBp),h=n(hy?.chg5dBp);
  if(h!=null&&y2!=null&&h>=25&&y2>=15)return {label:"동시 압박",color:"orange",reason:`HY +${h.toFixed(0)}bp · 2Y +${y2.toFixed(0)}bp/5D`};
  if(h!=null&&h>=25)return {label:"신용 악화",color:"orange",reason:`HY OAS +${h.toFixed(0)}bp/5D`};
  if(y2!=null&&y2>=15)return {label:"금리 재가격",color:"yellow",reason:`2Y +${y2.toFixed(0)}bp/5D`};
  if(h!=null&&h<=-20&&y2!=null&&y2<=0)return {label:"압력 완화",color:"green",reason:"HY 축소 + 2Y 안정"};
  return {label:"감시",color:"yellow",reason:"신용·금리 동시악화 미확인"};
}
function classify(ulsd,retail){
  const f5=n(ulsd?.chg5dPct),f20=n(ulsd?.chg20dPct),wow=n(retail?.wowPct),w4=n(retail?.fourWeekPct);
  if((f5!=null&&f5>=7)||(f20!=null&&f20>=15)||(wow!=null&&wow>=2)||(w4!=null&&w4>=8))return {state:"악화",color:"orange",stage:"선행 디젤 충격"};
  if((f5!=null&&f5<=-5)&&(wow==null||wow<=0))return {state:"개선",color:"green",stage:"디젤 압력 완화"};
  return {state:"감시",color:"yellow",stage:"지표 전이 확인 전"};
}
async function loadDieselFootprint(){
  const now=Date.now();
  if(cache.data&&now-cache.at<TTL_MS)return cache.data;
  const settled=await Promise.allSettled([
    yahooSeries("HO=F","6mo","1d"),
    fredDiesel(),
    yahooSeries("CL=F","3mo","1d"),
    yahooSeries("^TNX","3mo","1d"),
    fredMarketSeries("DGS2",180),
    fredMarketSeries("BAMLH0A0HYM2",180)
  ]);
  const val=(i)=>settled[i].status==="fulfilled"?settled[i].value:null;
  const errors=settled.map((r,i)=>r.status==="rejected"?`${["ULSD","RETAIL","WTI","10Y","2Y","HY_OAS"][i]}:${String(r.reason?.message||r.reason)}`:null).filter(Boolean);
  const ulsd=val(0),retail=val(1),wti=val(2),tenY=val(3),us2y=val(4),hyOas=val(5);
  const anchor=detectShockAnchor(ulsd?.rows||[]);
  const state=classify(ulsd,retail),credit=creditSignal(us2y,hyOas);
  const data={
    updatedAt:new Date().toISOString(),
    available:!!(ulsd||retail),
    state:state.state,
    color:state.color,
    stage:state.stage,
    ulsd:ulsd?{price:ulsd.price,tradedAt:ulsd.tradedAt,chg1dPct:ulsd.chg1dPct,chg5dPct:ulsd.chg5dPct,chg20dPct:ulsd.chg20dPct,unit:"USD/gal",source:ulsd.source}:null,
    retail,
    wti:wti?{price:wti.price,tradedAt:wti.tradedAt,chg5dPct:wti.chg5dPct,unit:"USD/bbl",source:wti.source}:null,
    us10y:tenY?{yieldPct:tenY.price,tradedAt:tenY.tradedAt,chg5dPct:tenY.chg5dPct,unit:"%",source:tenY.source}:null,
    us2y:us2y?{yieldPct:us2y.value,asOf:us2y.asOf,chg5dBp:us2y.chg5dBp,chg20dBp:us2y.chg20dBp,source:us2y.source}:null,
    hyOas:hyOas?{spreadPct:hyOas.value,asOf:hyOas.asOf,chg5dBp:hyOas.chg5dBp,chg20dBp:hyOas.chg20dBp,source:hyOas.source}:null,
    creditSignal:credit,
    anchor:{detected:anchor.detected,date:anchor.date.toISOString(),reason:anchor.reason},
    timeline:buildTimeline(anchor.date),
    maturityWall:MATURITY_WALL,
    hypothesis:"디젤 충격의 직접 전이는 0~6개월을 우선 감시하고, 이후에는 고금리가 지속될 때 회사채 만기벽과 결합하는지를 별도로 본다. 만기벽 자체를 디젤의 직접 결과로 간주하지 않는다.",
    errors
  };
  cache={at:now,data};
  return data;
}

const STYLE=`<style id="gn-diesel-footprint-style-v1">
#gnDieselFootprint{margin:14px 0;background:#10151b;border:1px solid #2d3945;border-radius:16px;padding:15px}.gnDfHead{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.gnDfTitle{font-size:17px;font-weight:950}.gnDfSub{font-size:11px;color:#8794a2;margin-top:3px}.gnDfState{font-size:12px;font-weight:900;border:1px solid #3a4652;border-radius:999px;padding:6px 9px;white-space:nowrap}.gnDfState.green{color:#55d98b}.gnDfState.yellow{color:#ffd166}.gnDfState.orange{color:#ff9f43}.gnDfGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:12px}.gnDfCard{background:#121920;border:1px solid #27313b;border-radius:12px;padding:10px}.gnDfLabel{font-size:10px;color:#8f9ca8}.gnDfValue{font-size:18px;font-weight:950;margin-top:3px}.gnDfMeta{font-size:10px;color:#8f9ca8;margin-top:3px}.gnDfTimeline{margin-top:12px;border-top:1px solid #27313b}.gnDfRow{display:grid;grid-template-columns:.55fr 1.15fr 1.4fr;gap:8px;padding:9px 2px;border-bottom:1px solid #202a33;font-size:11px;align-items:center}.gnDfLag{font-weight:900}.gnDfWindow{color:#ffd166;font-weight:850}.gnDfTarget{color:#cbd4dc}.gnDfNote{margin-top:10px;color:#8f9ca8;font-size:10px;line-height:1.5}.gnDfErr{color:#ff8585}@media(max-width:620px){.gnDfGrid{grid-template-columns:repeat(2,1fr)}.gnDfRow{grid-template-columns:.55fr 1fr}.gnDfTarget{grid-column:1 / -1;padding-left:2px}}
</style>`;
const PANEL=`<section id="gnDieselFootprint"><div class="gnDfHead"><div><div class="gnDfTitle">시장 발자국 · 디젤 → 미국지표</div><div class="gnDfSub">ULSD · 미국 소매 디젤 · WTI · 10Y · 3~6개월 지연 전이 시계월</div></div><div id="gnDfState" class="gnDfState yellow">감시</div></div><div id="gnDfGrid" class="gnDfGrid"><div class="gnDfCard"><div class="gnDfLabel">ULSD 선물</div><div class="gnDfValue">--</div></div><div class="gnDfCard"><div class="gnDfLabel">미국 소매 디젤</div><div class="gnDfValue">--</div></div><div class="gnDfCard"><div class="gnDfLabel">WTI</div><div class="gnDfValue">--</div></div><div class="gnDfCard"><div class="gnDfLabel">미국 10Y</div><div class="gnDfValue">--</div></div></div><div id="gnDfTimeline" class="gnDfTimeline"></div><div id="gnDfNote" class="gnDfNote">디젤 전이 시계월 계산 중…</div></section>`;
const SCRIPT=`<script id="gn-diesel-footprint-ui-v1">(function(){
function n(v){var x=Number(v);return Number.isFinite(x)?x:null}
function f(v,d){var x=n(v);return x==null?'--':x.toFixed(d==null?2:d)}
function p(v){var x=n(v);return x==null?'--':(x>=0?'+':'')+x.toFixed(2)+'%'}
function esc(v){return String(v==null?'':v).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function render(d){
 var s=document.getElementById('gnDfState'),g=document.getElementById('gnDfGrid'),t=document.getElementById('gnDfTimeline'),note=document.getElementById('gnDfNote');if(!s||!g||!t||!note)return;
 s.className='gnDfState '+(d.color||'yellow');s.textContent=(d.state||'감시')+' · '+(d.stage||'');
 var u=d.ulsd||{},r=d.retail||{},w=d.wti||{},y=d.us10y||{};
 g.innerHTML=
 '<div class="gnDfCard"><div class="gnDfLabel">ULSD 선물 HO=F</div><div class="gnDfValue">$'+f(u.price,3)+'/gal</div><div class="gnDfMeta">1D '+p(u.chg1dPct)+' · 5D '+p(u.chg5dPct)+' · 20D '+p(u.chg20dPct)+'</div></div>'+
 '<div class="gnDfCard"><div class="gnDfLabel">미국 소매 디젤</div><div class="gnDfValue">$'+f(r.price,3)+'/gal</div><div class="gnDfMeta">주간 '+p(r.wowPct)+' · 4주 '+p(r.fourWeekPct)+' · '+esc(r.asOf||'')+'</div></div>'+
 '<div class="gnDfCard"><div class="gnDfLabel">WTI</div><div class="gnDfValue">$'+f(w.price,2)+'</div><div class="gnDfMeta">5D '+p(w.chg5dPct)+'</div></div>'+
 '<div class="gnDfCard"><div class="gnDfLabel">미국 10Y</div><div class="gnDfValue">'+f(y.yieldPct,2)+'%</div><div class="gnDfMeta">5D '+p(y.chg5dPct)+'</div></div>';
 t.innerHTML=(d.timeline||[]).map(function(x){return '<div class="gnDfRow"><div class="gnDfLag">'+esc(x.lag)+'</div><div class="gnDfWindow">'+esc(x.window)+'</div><div class="gnDfTarget">'+esc(x.target)+' · '+esc(x.meaning)+'</div></div>'}).join('');
 var anchor=d.anchor||{};note.innerHTML='<b>시계월 기준:</b> '+esc(anchor.detected?'디젤 충격 감지일 '+String(anchor.date||'').slice(0,10):'강한 신규 충격 미검출 · 현재월 감시 기준')+'<br>'+esc(d.hypothesis||'')+(d.errors&&d.errors.length?'<br><span class="gnDfErr">부분 데이터: '+esc(d.errors.join(' | '))+'</span>':'');
}
async function load(){try{var res=await fetch('/api/diesel-footprint?t='+Date.now(),{cache:'no-store'});if(res.status===401){location.href='/login';return}if(!res.ok)throw Error('HTTP '+res.status);render(await res.json())}catch(e){var s=document.getElementById('gnDfState'),n=document.getElementById('gnDfNote');if(s){s.className='gnDfState yellow';s.textContent='데이터 재연결'}if(n)n.textContent='디젤 데이터 재조회 중'}}load();setInterval(load,60000);
})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("gnDieselFootprint"))return html;
  let out=html.replace("</head>",STYLE+"</head>");
  if(out.includes('<div class="tabs">'))out=out.replace('<div class="tabs">',PANEL+'<div class="tabs">');
  else if(out.includes("</header>"))out=out.replace("</header>","</header>"+PANEL);
  else out=out.replace("</body>",PANEL+"</body>");
  return out.replace("</body>",SCRIPT+"</body>");
}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{
    if(req.path==="/api/diesel-footprint"){
      return loadDieselFootprint().then(data=>{res.set("Cache-Control","no-store");res.json(data);}).catch(e=>res.status(500).json({error:String(e?.message||e)}));
    }
    const send=res.send.bind(res);
    res.send=function(body){return send(patchHtml(body));};
    next();
  });
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;

module.exports={pct,detectShockAnchor,buildTimeline,classify,loadDieselFootprint};
