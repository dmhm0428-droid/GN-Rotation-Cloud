"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");

const WATCH=[
  {symbol:"MNDY",name:"먼데이닷컴",role:"AI SW"},
  {symbol:"IREN",name:"아이렌",role:"AI/HPC"}
];
const QUOTE_TTL_MS=45000;
let quoteCache={at:0,data:null};

function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
async function usQuote(item){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),5000);
  try{
    const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.symbol)}?interval=1m&range=1d`;
    const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 GN-PIVOT/1.0","accept":"application/json"},signal:c.signal});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const p=await r.json(),m=p?.chart?.result?.[0]?.meta||{};
    const price=num(m.regularMarketPrice),prev=num(m.chartPreviousClose??m.previousClose);
    if(price==null)throw new Error("NO_QUOTE_DATA");
    const changePct=prev&&prev!==0?((price-prev)/prev)*100:null;
    return {...item,price,changePct,currency:m.currency||"USD",marketState:m.marketState||null,tradedAt:m.regularMarketTime?new Date(m.regularMarketTime*1000).toISOString():null,source:"YAHOO_FINANCE_CHART"};
  }catch(error){
    return {...item,price:null,changePct:null,currency:"USD",marketState:null,tradedAt:null,source:"UNAVAILABLE",error:String(error?.name==="AbortError"?"QUOTE_TIMEOUT":error?.message||error)};
  }finally{clearTimeout(timer);}
}
async function watchStocks(req,res){
  try{
    if(quoteCache.data&&Date.now()-quoteCache.at<QUOTE_TTL_MS){res.set("Cache-Control","no-store");return res.json(quoteCache.data);}
    const items=await Promise.all(WATCH.map(usQuote));
    const data={ts:new Date().toISOString(),items};
    quoteCache={at:Date.now(),data};
    res.set("Cache-Control","no-store");
    res.json(data);
  }catch(e){res.status(500).json({error:String(e?.message||e)});}
}

function zeroLike(v){const n=Number(v);return Number.isFinite(n)&&Math.abs(n)<1e-12;}
function stageMissing(v){const s=String(v??"").trim().toUpperCase();return !s||s==="--"||s==="NULL"||s==="UNKNOWN";}
function degenerateRows(rows){
  const xs=Array.isArray(rows)?rows:[];
  return xs.length>=2&&xs.every(r=>zeroLike(r?.rs_1d)&&zeroLike(r?.rs_5d)&&zeroLike(r?.flow_acceleration)&&stageMissing(r?.flow_stage));
}
function markDataWait(rows){
  return (rows||[]).map(r=>({...r,rank:"--",rs_1d:"N/A",rs_5d:"N/A",flow_acceleration:"N/A",flow_stage:"DATA_WAIT",rank_change:0}));
}
function sanitizeRotationPayload(body){
  if(!body||typeof body!=="object")return body;
  const out={...body};
  if(degenerateRows(out.assets)){
    out.assets=markDataWait(out.assets);
    out.summary={...(out.summary||{}),leader_asset:null,rotation_summary:null,rotation_from:null,rotation_to:null,data_status:"DATA_WAIT"};
  }
  if(degenerateRows(out.sectors))out.sectors=markDataWait(out.sectors);
  return out;
}

const SCRIPT=`<style id="gn-cleanup-watch-style-v1">
.gnWatchPrice{font-weight:900}.gnWatchMeta{font-size:11px;color:#8f9ba7;margin-top:4px}.gnDataWait{color:#ffd166!important}
</style><script id="gn-cleanup-watch-v1">(function(){
const esc=v=>String(v==null?'':v).replace(/[&<>\\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>Number.isFinite(Number(v))?'$'+Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'가격 대기';
let last=null,busy=false,timer=null;
function stockCard(){const host=document.getElementById('leaders');if(!host)return null;return Array.from(host.querySelectorAll('.leader')).find(x=>/주식/.test(x.querySelector('.leaderTop span')?.textContent||''))||null}
function applyWatch(){if(!last)return;const card=stockCard();if(!card)return;const items=last.items||[];const top=card.querySelector('.leaderTop span'),badge=card.querySelector('.leaderTop b'),sym=card.querySelector('.leaderSymbol'),meta=card.querySelector('.leaderMeta');if(top)top.textContent='주식 · 핵심 관찰';if(badge){badge.textContent='상세 아래';badge.className='warn'}if(sym)sym.innerHTML=items.map(x=>'<span class="gnWatchPrice">'+esc(x.symbol)+' '+esc(fmt(x.price))+'</span>').join(' · ');if(meta)meta.innerHTML='<span class="gnWatchMeta">MNDY AI 소프트웨어 · IREN AI/HPC · 중복 후보명은 아래 상세 섹터에서만 표시</span>'}
function fixRotation(){const rows=document.getElementById('rotationRows');if(!rows)return;const texts=Array.from(rows.children).map(x=>x.textContent||'');if(!texts.length||!texts.every(t=>t.includes('데이터대기')))return;const s=document.getElementById('rotationSummary'),l=document.getElementById('rotationLeader');if(s){s.textContent='자금회전 데이터 검증 대기 · 0값 순위 제외';s.classList.add('gnDataWait')}if(l){l.textContent='선두 데이터대기';l.classList.add('gnDataWait')}}
async function loadWatch(){if(busy)return;busy=true;try{const r=await fetch('/api/watch-stocks?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);last=await r.json();applyWatch()}catch(e){}finally{busy=false}}
function scheduleApply(){clearTimeout(timer);timer=setTimeout(()=>{applyWatch();fixRotation()},80)}
const obs=new MutationObserver(scheduleApply);obs.observe(document.documentElement,{subtree:true,childList:true});
setTimeout(()=>{loadWatch();fixRotation()},500);setInterval(loadWatch,15000);setInterval(fixRotation,3000);})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("<title>GN PIVOT</title>")||html.includes("gn-cleanup-watch-v1"))return html;
  return html.replace("</body>",SCRIPT+"</body>");
}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.get("/api/watch-stocks",watchStocks);
  app.use((req,res,next)=>{
    if(req.path==="/api/rotation/latest"){
      const json=res.json.bind(res);
      res.json=function(body){return json(sanitizeRotationPayload(body));};
    }
    const send=res.send.bind(res);
    res.send=function(body){return send(patchHtml(body));};
    next();
  });
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
