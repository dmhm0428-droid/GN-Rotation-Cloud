"use strict";

// GN PIVOT retirement ETF + Capital Flow Gateway dashboard layer.
// This is preloaded only for src/server.js. It deliberately does NOT replace
// the existing pre-pump/short-term engine. The new layer sits above it and
// decides whether the environment is RISK-ON / NEUTRAL / DEFENSIVE / CASH.

const expressPath=require.resolve("express");
const originalExpress=require("express");

const ETF_WATCHLIST=[
  {code:"487230",name:"KODEX 미국AI전력핵심인프라"},
  {code:"0173Y0",name:"KODEX 미국AI광통신네트워크"},
  {code:"491010",name:"TIGER 글로벌AI전력인프라액티브"},
  {code:"0023A0",name:"SOL 미국양자컴퓨팅TOP10"},
  {code:"449450",name:"PLUS K방산"}
];

const QUOTE_TTL_MS=45_000;
let quoteCache={at:0,data:null};

function num(value){
  if(value==null)return null;
  const n=Number(String(value).replaceAll(",","").replaceAll("%","").trim());
  return Number.isFinite(n)?n:null;
}

async function fetchQuote(item){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),6000);
  try{
    const url=`https://polling.finance.naver.com/api/realtime/domestic/stock/${encodeURIComponent(item.code)}`;
    const response=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 GN-PIVOT/1.0","accept":"application/json"},signal:controller.signal});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const payload=await response.json();
    const q=payload?.datas?.[0];
    if(!q)throw new Error("NO_QUOTE_DATA");
    return {
      ...item,
      price:num(q.closePrice),
      change:num(q.compareToPreviousClosePrice),
      changePct:num(q.fluctuationsRatio),
      marketStatus:q.marketStatus||null,
      tradedAt:q.localTradedAt||null,
      source:"NAVER_FINANCE_PUBLIC_QUOTE"
    };
  }catch(error){
    return {...item,error:String(error?.name==="AbortError"?"QUOTE_TIMEOUT":error?.message||error)};
  }finally{
    clearTimeout(timer);
  }
}

async function loadQuotes(){
  if(quoteCache.data&&Date.now()-quoteCache.at<QUOTE_TTL_MS)return quoteCache.data;
  const items=await Promise.all(ETF_WATCHLIST.map(fetchQuote));
  const data={ts:new Date().toISOString(),items,source:"NAVER_FINANCE_PUBLIC_QUOTE",note:"퇴직연금 후보 ETF · 증권사 주문/잔고 API 미사용 · 공개 현재가만 표시"};
  quoteCache={at:Date.now(),data};
  return data;
}

const FLOW_PANEL_HTML=`<h2>돈의 발자국 · Capital Flow Gateway</h2>
<div class="hero" id="capitalFlowBox">
  <div class="eyebrow">상위 자산배분 엔진 · 단타 엔진은 그대로 유지</div>
  <div class="action" id="flowRegime">계산 중…</div>
  <div class="subaction" id="flowAction">시장 전체 자금흐름 확인 중</div>
  <div class="muted" id="flowAllocation" style="margin-top:10px"></div>
  <div class="muted" id="flowScalp" style="margin-top:6px"></div>
</div>`;

const ETF_PANEL_HTML=`<h2>퇴직연금 ETF</h2><div class="muted" style="margin-bottom:8px">개별종목 추격보다 분산 ETF 중심 · 공개 시세 60초 자동 갱신</div><div class="grid" id="etfPrices"><div class="card muted">ETF 현재가 불러오는 중…</div></div>`;

const PANEL_SCRIPT=`<script>
(function(){
  function won(x){return x==null?'N/A':Number(x).toLocaleString()+'원';}
  function sign(x){const n=Number(x);if(!Number.isFinite(n))return '';return n>0?'+':'';}
  function cls(x){const n=Number(x);if(!Number.isFinite(n)||n===0)return '';return n>0?'good':'bad';}
  function n(v){v=Number(v);return Number.isFinite(v)?v:null;}

  function allocationFor(regime){
    if(regime==='RISK-ON')return {cash:15,safe:15,stock:45,crypto:25,label:'위험자산 우위'};
    if(regime==='DEFENSIVE')return {cash:40,safe:35,stock:20,crypto:5,label:'방어 우위'};
    if(regime==='CASH')return {cash:60,safe:30,stock:10,crypto:0,label:'현금 우위'};
    return {cash:30,safe:25,stock:30,crypto:15,label:'중립'};
  }

  function classifyFlow(market,top3){
    var d=market&&market.decision||{};
    var score=n(d.score); if(score==null)score=50;
    var action=String(d.action||'');
    var ai=market&&market.ai||{};
    var aiRiskOff=ai&&ai.eligible===true&&ai.sentiment==='risk_off';
    var activeEntry=(top3||[]).filter(function(x){return x&&x.action==='진입';}).length;
    var activeScout=(top3||[]).filter(function(x){return x&&x.action==='선발대';}).length;
    var regime='NEUTRAL';
    if(score<30||action==='매수금지')regime='CASH';
    else if(score<45||aiRiskOff)regime='DEFENSIVE';
    else if(score>=62&&(activeEntry>0||activeScout>=2))regime='RISK-ON';
    var alloc=allocationFor(regime);
    var scalp=regime==='RISK-ON'?'ACTIVE · ENTRY/선발대 허용':regime==='NEUTRAL'?'SELECTIVE · ENTRY 우선, SCOUT 축소':regime==='DEFENSIVE'?'RESTRICTED · 상대강도 최상위만':'OFF · 신규 단타 중단';
    return {regime:regime,alloc:alloc,scalp:scalp,score:score,action:action||'관찰'};
  }

  async function loadCapitalFlow(){
    var box=document.getElementById('capitalFlowBox');if(!box)return;
    try{
      var results=await Promise.all([fetch('/api/market/live'),fetch('/api/pre-pump/latest')]);
      if(!results[0].ok)throw new Error('시장 API '+results[0].status);
      var market=await results[0].json();
      var top3=results[1].ok?await results[1].json():[];
      var f=classifyFlow(market,Array.isArray(top3)?top3:[]);
      var regimeEl=document.getElementById('flowRegime');
      regimeEl.textContent=f.regime;
      regimeEl.className='action '+(f.regime==='RISK-ON'?'good':f.regime==='NEUTRAL'?'warn':'bad');
      document.getElementById('flowAction').textContent=f.alloc.label+' · 시장점수 '+Math.round(f.score)+' · '+f.action;
      document.getElementById('flowAllocation').textContent='기준배분(모델): 현금 '+f.alloc.cash+'% · 안전자산 '+f.alloc.safe+'% · 주식/ETF '+f.alloc.stock+'% · 크립토 '+f.alloc.crypto+'%';
      document.getElementById('flowScalp').textContent='단타 엔진: '+f.scalp+' · 기존 Pre-Pump 로직 유지';
    }catch(e){
      document.getElementById('flowRegime').textContent='데이터 확인';
      document.getElementById('flowRegime').className='action warn';
      document.getElementById('flowAction').textContent='Capital Flow 계산 오류 · '+e.message;
      document.getElementById('flowAllocation').textContent='기존 단타 엔진은 영향 없이 계속 동작';
    }
  }

  async function loadEtfPrices(){
    const box=document.getElementById('etfPrices');if(!box)return;
    try{
      const r=await fetch('/api/etf/latest');if(!r.ok)throw new Error('HTTP '+r.status);
      const d=await r.json();
      box.innerHTML=(d.items||[]).map(function(x){
        if(x.error)return '<div class="card"><b>'+x.name+'</b><div class="bad">시세 조회 실패</div><div class="muted">'+x.code+' · '+x.error+'</div></div>';
        return '<div class="card"><div class="muted">'+x.code+'</div><b>'+x.name+'</b><div class="score">'+won(x.price)+'</div><div class="'+cls(x.changePct)+'">'+sign(x.change)+Number(x.change||0).toLocaleString()+'원 · '+sign(x.changePct)+Number(x.changePct||0).toFixed(2)+'%</div><div class="muted">'+(x.marketStatus||'')+(x.tradedAt?' · '+new Date(x.tradedAt).toLocaleString():'')+'</div></div>';
      }).join('');
    }catch(e){box.innerHTML='<div class="card bad">ETF 시세 오류 · '+e.message+'</div>';}
  }

  loadCapitalFlow();loadEtfPrices();
  setInterval(loadCapitalFlow,60000);
  setInterval(loadEtfPrices,60000);
})();
</script>`;

function injectDashboard(html){
  if(typeof html!=="string"||!html.includes("GN 시장 전체 감시"))return html;
  if(!html.includes('id="capitalFlowBox"')){
    const firstAnchor="<h2>BTC · ETH · SOL</h2>";
    if(html.includes(firstAnchor))html=html.replace(firstAnchor,FLOW_PANEL_HTML+firstAnchor);
    else html=html.replace("</body>",FLOW_PANEL_HTML+"</body>");
  }
  if(!html.includes('id="etfPrices"')){
    const anchor="<h2>거래소 잔고</h2>";
    if(html.includes(anchor))html=html.replace(anchor,ETF_PANEL_HTML+anchor);
    else html=html.replace("</body>",ETF_PANEL_HTML+"</body>");
  }
  if(!html.includes("loadCapitalFlow()"))html=html.replace("</body>",PANEL_SCRIPT+"</body>");
  return html;
}

function wrappedExpress(...args){
  const app=originalExpress(...args);
  app.use((req,res,next)=>{
    if(req.path==="/api/etf/latest"){
      loadQuotes().then(data=>res.json(data)).catch(error=>res.status(500).json({error:String(error?.message||error)}));
      return;
    }
    const originalSend=res.send.bind(res);
    res.send=function(body){return originalSend(injectDashboard(body));};
    next();
  });
  return app;
}

Object.assign(wrappedExpress,originalExpress);
require.cache[expressPath].exports=wrappedExpress;
