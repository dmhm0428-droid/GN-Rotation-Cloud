"use strict";

// GN PIVOT retirement ETF quote panel.
// Preloaded only for src/server.js so we can add a lightweight public-price
// endpoint and dashboard panel without mixing brokerage credentials into GN.

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
  const data={ts:new Date().toISOString(),items,source:"NAVER_FINANCE_PUBLIC_QUOTE",note:"증권사 잔고/주문 API 미사용 · 공개 현재가만 표시"};
  quoteCache={at:Date.now(),data};
  return data;
}

const PANEL_HTML=`<h2>퇴직연금 ETF 현재가</h2><div class="muted" style="margin-bottom:8px">증권사 잔고 연결 없이 공개 시세만 표시 · 60초 자동 갱신</div><div class="grid" id="etfPrices"><div class="card muted">ETF 현재가 불러오는 중…</div></div>`;

const PANEL_SCRIPT=`<script>
(function(){
  function won(x){return x==null?'N/A':Number(x).toLocaleString()+'원';}
  function sign(x){const n=Number(x);if(!Number.isFinite(n))return '';return n>0?'+':'';}
  function cls(x){const n=Number(x);if(!Number.isFinite(n)||n===0)return '';return n>0?'good':'bad';}
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
  loadEtfPrices();setInterval(loadEtfPrices,60000);
})();
</script>`;

function injectDashboard(html){
  if(typeof html!=="string"||!html.includes("GN 시장 전체 감시")||html.includes('id="etfPrices"'))return html;
  const anchor="<h2>거래소 잔고</h2>";
  if(html.includes(anchor))html=html.replace(anchor,PANEL_HTML+anchor);
  else html=html.replace("</body>",PANEL_HTML+"</body>");
  return html.replace("</body>",PANEL_SCRIPT+"</body>");
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
