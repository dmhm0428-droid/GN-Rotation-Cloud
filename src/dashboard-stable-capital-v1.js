"use strict";

const expressPath=require.resolve("express");
const previousExpress=require("express");

const TTL_MS=5*60*1000;
let cache={ts:0,data:null};

function pct(change,total){
  const c=Number(change),t=Number(total);
  if(!Number.isFinite(c)||!Number.isFinite(t)||t<=0)return null;
  const prev=t-c;
  if(!Number.isFinite(prev)||prev<=0)return null;
  return +(c/prev*100).toFixed(2);
}

function classify(v){
  if(!Number.isFinite(v))return "데이터없음";
  if(v>=0.25)return "증가";
  if(v<=-0.25)return "이탈";
  return "유지";
}

async function fetchBalance(symbol){
  const key=process.env.COINGLASS_API_KEY||process.env.CG_API_KEY||"";
  if(!key)throw new Error("COINGLASS_API_KEY missing");
  const u="https://open-api-v4.coinglass.com/api/exchange/balance/list?symbol="+encodeURIComponent(symbol);
  const r=await fetch(u,{headers:{"CG-API-KEY":key,"accept":"application/json"},signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw new Error(`coinglass ${symbol} ${r.status}`);
  const j=await r.json();
  if(String(j?.code)!=="0"||!Array.isArray(j?.data))throw new Error(`coinglass ${symbol} bad response`);
  return j.data;
}

async function loadStableCapital(){
  const now=Date.now();
  if(cache.data&&now-cache.ts<TTL_MS)return cache.data;
  try{
    const [usdt,usdc]=await Promise.all([fetchBalance("USDT(ETH)"),fetchBalance("USDC")]);
    const rows=[...usdt,...usdc];
    const sums=rows.reduce((a,r)=>{
      a.total+=Number(r?.total_balance)||0;
      a.d1+=Number(r?.balance_change_1d)||0;
      a.d7+=Number(r?.balance_change_7d)||0;
      return a;
    },{total:0,d1:0,d7:0});
    const p1=pct(sums.d1,sums.total);
    const p7=pct(sums.d7,sums.total);
    const state=classify(p1);
    const data={state,change24hPct:p1,change7dPct:p7,source:"CoinGlass exchange balances",updatedAt:new Date().toISOString(),available:true};
    cache={ts:now,data};
    return data;
  }catch(error){
    const data={state:"데이터없음",change24hPct:null,change7dPct:null,source:"CoinGlass exchange balances",updatedAt:new Date().toISOString(),available:false,error:String(error?.message||error)};
    cache={ts:now,data};
    return data;
  }
}

const STYLE=`<style id="gn-stable-capital-style">
#gnStableCapital{margin:8px 0 12px;padding:10px 12px;border:1px solid #263341;border-radius:10px;background:#101820;display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:12px}.gnStableTitle{font-weight:900}.gnStableState{font-size:15px;font-weight:900}.gnStableState.up{color:#55d98b}.gnStableState.flat{color:#ffd166}.gnStableState.down{color:#ff6b6b}.gnStableMeta{color:#9eabb8}.gnStableHint{color:#7f8d9a;font-size:10px}@media(max-width:560px){#gnStableCapital{gap:7px}.gnStableMeta{width:100%}}
</style>`;

const SCRIPT=`<script id="gn-stable-capital-ui">(function(){
 var last=null,oldFetch=window.fetch.bind(window);
 function n(v){var x=Number(v);return Number.isFinite(x)?x:null}
 function fmt(v){var x=n(v);return x==null?'--':(x>=0?'+':'')+x.toFixed(2)+'%'}
 function cls(s){return s==='증가'?'up':s==='이탈'?'down':'flat'}
 function render(d){if(!d||!d.stableCapital)return;last=d.stableCapital;var top=document.getElementById('top3');if(!top)return;var sec=top.closest('section')||top.parentElement;if(!sec)return;var el=document.getElementById('gnStableCapital');if(!el){el=document.createElement('div');el.id='gnStableCapital';top.parentElement.insertBefore(el,top)}var x=last;if(x.available===false){el.innerHTML='<span class="gnStableTitle">STABLE 대기자금</span><span class="gnStableState flat">연결 대기</span><span class="gnStableHint">확인값 없으면 판정하지 않음</span>';return}el.innerHTML='<span class="gnStableTitle">STABLE 대기자금</span><span class="gnStableState '+cls(x.state)+'">'+x.state+'</span><span class="gnStableMeta">24h '+fmt(x.change24hPct)+' · 7d '+fmt(x.change7dPct)+'</span>'}
 window.fetch=async function(){var args=[].slice.call(arguments),r=await oldFetch.apply(window,args);try{var u=String(args[0]&&args[0].url?args[0].url:args[0]||'');if(u.indexOf('/api/live-summary')>=0)r.clone().json().then(render).catch(function(){})}catch(e){}return r};
 setInterval(function(){if(last)render({stableCapital:last})},5000);
})();</script>`;

function patchHtml(html){if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("gn-stable-capital-ui"))return html;return html.replace("</body>",STYLE+SCRIPT+"</body>");}

function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{
    if(req.path==="/api/live-summary"){
      const json=res.json.bind(res);
      res.json=async body=>{
        try{return json({...body,stableCapital:await loadStableCapital()});}catch{return json(body);}
      };
    }
    const send=res.send.bind(res);
    res.send=body=>send(patchHtml(body));
    next();
  });
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
