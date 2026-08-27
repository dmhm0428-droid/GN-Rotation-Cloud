"use strict";

// Dashboard compatibility + presentation patch.
// Keeps all existing GN panels intact while:
// 1) preserving the legacy marker required by the existing injector,
// 2) normalizing only broad dashboard actions to simple 매수/대기/매도 labels,
// 3) preserving TOP3-specific states such as 검증중,
// 4) replacing stale BTC/ETH/SOL snapshot prices with fresh public Upbit quotes,
// 5) hardening dashboard buttons for mobile touch.

const expressPath=require.resolve("express");
const priorExpress=require("express");

let priceCache={at:0,data:null};
const PRICE_TTL_MS=10_000;

async function loadLiveCryptoPrices(){
  if(priceCache.data&&Date.now()-priceCache.at<PRICE_TTL_MS)return priceCache.data;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),5000);
  try{
    const url="https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH,KRW-SOL";
    const r=await fetch(url,{headers:{"accept":"application/json","user-agent":"GN-PIVOT/1.0"},signal:controller.signal});
    if(!r.ok)throw new Error(`UPBIT_HTTP_${r.status}`);
    const rows=await r.json();
    const prices={};
    for(const row of rows||[]){
      const symbol=String(row.market||"").replace("KRW-","");
      if(symbol)prices[symbol]=Number(row.trade_price)||null;
    }
    const data={ts:new Date().toISOString(),source:"UPBIT_PUBLIC_TICKER",prices};
    priceCache={at:Date.now(),data};
    return data;
  }finally{clearTimeout(timer);}
}

const MOBILE_STYLE=`<style data-gn-mobile-touch="1">
button,[role="button"],a.logout{touch-action:manipulation;-webkit-tap-highlight-color:rgba(255,255,255,.12);pointer-events:auto;position:relative;z-index:2;min-height:42px}
button:disabled{opacity:.55}
@media(max-width:560px){button,[role="button"],a.logout{min-height:46px;min-width:46px;font-size:15px}}
</style>`;

const UI_SCRIPT=`<script data-gn-dashboard-ui="1">
(function(){
  function normalizeActions(root){
    var scope=root&&root.querySelectorAll?root:document;
    // TOP3 .pickAction is intentionally excluded. It must keep semantic states
    // such as 검증중 instead of being flattened to generic 대기.
    var nodes=scope.querySelectorAll('.action,.coinAction,.subaction');
    nodes.forEach(function(el){
      var t=(el.textContent||'').trim();
      if(t==='사라'||t==='확인매수'||t==='추가매수'||t==='진입')el.textContent='매수';
      else if(t==='사지 마라'||t==='매수금지'||t==='기다려'||t==='관찰'||t==='추격금지')el.textContent='대기';
      else if(t==='분할회수'||t==='강제정리'||t==='축소'||t==='매도')el.textContent='매도';
    });
  }

  function formatWon(v){
    var n=Number(v);return Number.isFinite(n)?Math.round(n).toLocaleString('ko-KR')+'원':'N/A';
  }

  function updateCoinCard(symbol,price){
    var names=[].slice.call(document.querySelectorAll('.coinName'));
    var nameEl=names.find(function(el){return (el.textContent||'').trim().toUpperCase()===symbol;});
    if(!nameEl)return;
    var card=nameEl.closest('.card')||nameEl.parentElement;
    if(!card)return;
    var priceEl=card.querySelector('.price');
    if(priceEl){
      priceEl.textContent=formatWon(price);
      priceEl.setAttribute('data-live-source','UPBIT');
      priceEl.title='업비트 공개시세 · 자동갱신';
    }
  }

  async function refreshLivePrices(){
    try{
      var r=await fetch('/api/public-crypto-prices',{cache:'no-store'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      var d=await r.json();
      ['BTC','ETH','SOL'].forEach(function(s){if(d.prices&&d.prices[s]!=null)updateCoinCard(s,d.prices[s]);});
    }catch(e){console.warn('GN live crypto price refresh failed',e&&e.message||e);}
  }

  function isRefreshControl(el){
    if(!el)return false;
    var t=((el.textContent||'')+' '+(el.getAttribute&&el.getAttribute('aria-label')||'')+' '+(el.title||'')).toLowerCase();
    return t.indexOf('새로고침')>=0||t.indexOf('refresh')>=0;
  }

  document.addEventListener('click',function(ev){
    var el=ev.target&&ev.target.closest?ev.target.closest('button,[role="button"],a'):null;
    if(!el||!isRefreshControl(el))return;
    ev.preventDefault();
    ev.stopPropagation();
    location.reload();
  },true);

  document.addEventListener('touchend',function(ev){
    var el=ev.target&&ev.target.closest?ev.target.closest('button,[role="button"],a'):null;
    if(!el||!isRefreshControl(el))return;
    ev.preventDefault();
    location.reload();
  },{capture:true,passive:false});

  normalizeActions(document);
  var observer=new MutationObserver(function(){normalizeActions(document);});
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  refreshLivePrices();
  setInterval(refreshLivePrices,15000);
})();
</script>`;

function patchDashboard(html){
  if(typeof html!=="string")return html;
  if(!html.includes("GN PIVOT"))return html;

  if(!html.includes("GN 시장 전체 감시")){
    html=html.replace("</body>",'<span style="display:none" aria-hidden="true">GN 시장 전체 감시</span></body>');
  }
  if(!html.includes('data-gn-mobile-touch="1"')){
    html=html.replace("</head>",MOBILE_STYLE+"</head>");
  }
  if(!html.includes('data-gn-dashboard-ui="1"')){
    html=html.replace("</body>",UI_SCRIPT+"</body>");
  }
  return html;
}

function wrappedExpress(...args){
  const app=priorExpress(...args);
  app.use((req,res,next)=>{
    if(req.path==="/api/public-crypto-prices"){
      loadLiveCryptoPrices().then(data=>res.json(data)).catch(error=>res.status(502).json({error:String(error?.message||error)}));
      return;
    }
    const originalSend=res.send.bind(res);
    res.send=function(body){return originalSend(patchDashboard(body));};
    next();
  });
  return app;
}

Object.assign(wrappedExpress,priorExpress);
require.cache[expressPath].exports=wrappedExpress;
