"use strict";

// Adds a simple, numeric-only staged buy plan to each TOP3 row.
// This is a planning aid, not an automatic trade instruction.
const expressPath=require.resolve("express");
const previousExpress=require("express");

function finite(v){const n=Number(v);return Number.isFinite(n)&&n>0?n:null;}
function roundPx(v){
  if(!Number.isFinite(v)||v<=0)return null;
  if(v>=1000000)return Math.round(v/100)*100;
  if(v>=100000)return Math.round(v/10)*10;
  if(v>=10000)return Math.round(v);
  if(v>=1000)return Math.round(v*10)/10;
  if(v>=100)return Math.round(v*100)/100;
  if(v>=1)return Math.round(v*1000)/1000;
  return Math.round(v*1000000)/1000000;
}
function planFor(row){
  const current=finite(row?.currentPrice??row?.krwPrice);
  const entryLow=finite(row?.entryLow);
  const first=finite(row?.firstDetectedPrice);
  if(!current&&!entryLow&&!first)return null;
  const p1=entryLow??current??first;
  const structural=first&&first<p1&&first>=p1*.94?first:null;
  const p2=structural??p1*.97;
  const p3=p2*.97;
  const invalid=p3*.97;
  const budget=finite(process.env.TOP3_POSITION_BUDGET_KRW);
  return {
    buy1:roundPx(p1), buy2:roundPx(p2), buy3:roundPx(p3), invalidPrice:roundPx(invalid),
    allocationPct:[40,35,25],
    allocationKrw:budget?[Math.round(budget*.40),Math.round(budget*.35),Math.round(budget*.25)]:null,
    budgetKrw:budget
  };
}
function addPlans(body){
  if(!body||typeof body!=="object"||Array.isArray(body))return body;
  const rows=Array.isArray(body.cryptoRadar)?body.cryptoRadar:[];
  const near=Array.isArray(body.cryptoNearMiss)?body.cryptoNearMiss:[];
  const map=r=>{const p=planFor(r);return p?{...r,buyPlan:p}:r;};
  return {...body,cryptoRadar:rows.map(map),cryptoNearMiss:near.map(map)};
}

const STYLE=`<style id="gn-top3-buy-plan-style">.gnBuyPlan{font-size:11px;line-height:1.55;margin-top:5px;font-weight:800;color:#d5dde5}.gnBuyPlan b{font-weight:900}.gnBuyPlan .inv{color:#ff9a9a}</style>`;
const SCRIPT=`<script id="gn-top3-buy-plan-ui">(function(){
 var last=null,oldFetch=window.fetch.bind(window);
 function n(v){var x=Number(v);return Number.isFinite(x)?x:null}
 function px(v){var x=n(v);if(x==null)return '--';return x.toLocaleString('ko-KR',{maximumFractionDigits:x<1?6:x<100?3:x<1000?2:0})+'원'}
 function apply(){if(!last)return;var rows=Array.isArray(last.cryptoRadar)?last.cryptoRadar:[];var cards=document.querySelectorAll('#top3 [data-gn-leading-card="1"]');for(var i=0;i<Math.min(rows.length,cards.length);i++){var r=rows[i],p=r&&r.buyPlan;if(!p)continue;var host=cards[i].querySelector('.gnLeadMetrics');if(!host||cards[i].querySelector('.gnBuyPlan'))continue;var a=Array.isArray(p.allocationPct)?p.allocationPct:[40,35,25];var amt=Array.isArray(p.allocationKrw)?(' · '+p.allocationKrw.map(function(x){return Number(x).toLocaleString('ko-KR')+'원'}).join('/')):'';host.insertAdjacentHTML('afterend','<div class="gnBuyPlan">매수 '+px(p.buy1)+' / '+px(p.buy2)+' / '+px(p.buy3)+' · 배분 '+a.join('/')+'%'+amt+' · <span class="inv">무효 '+px(p.invalidPrice)+'</span></div>')}}
 window.fetch=async function(){var args=[].slice.call(arguments),r=await oldFetch.apply(window,args);try{var u=String(args[0]&&args[0].url?args[0].url:args[0]||'');if(u.indexOf('/api/live-summary')>=0)r.clone().json().then(function(d){last=d;setTimeout(apply,100);setTimeout(apply,350)}).catch(function(){})}catch(e){}return r};
 new MutationObserver(function(){if(last)setTimeout(apply,30)}).observe(document.documentElement,{subtree:true,childList:true});
})();</script>`;
function patchHtml(html){if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("gn-top3-buy-plan-ui"))return html;return html.replace("</body>",STYLE+SCRIPT+"</body>");}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{
    if(req.path==="/api/live-summary"){
      const json=res.json.bind(res);res.json=body=>json(addPlans(body));
    }
    const send=res.send.bind(res);res.send=body=>send(typeof body==="string"?patchHtml(body):body);
    next();
  });
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
module.exports={planFor,addPlans};
