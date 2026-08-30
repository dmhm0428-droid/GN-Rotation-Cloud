"use strict";

const expressPath=require.resolve("express");
const previousExpress=require("express");

const MAX_QUOTE_AGE_MS=20*60*1000;
const FETCH_TIMEOUT_MS=5000;
const METALS=[
  {key:"gold",name:"금",symbol:"GC=F"},
  {key:"silver",name:"은",symbol:"SI=F"}
];

function lastFiniteQuote(result){
  const timestamps=Array.isArray(result?.timestamp)?result.timestamp:[];
  const closes=result?.indicators?.quote?.[0]?.close||[];
  for(let i=Math.min(timestamps.length,closes.length)-1;i>=0;i--){
    const price=Number(closes[i]),ts=Number(timestamps[i]);
    if(Number.isFinite(price)&&Number.isFinite(ts))return {price,ts};
  }
  return null;
}

async function fetchYahoo(symbol){
  const hosts=["query1.finance.yahoo.com","query2.finance.yahoo.com"];
  let lastError="quote unavailable";
  for(const host of hosts){
    try{
      const url=`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=true`;
      const r=await fetch(url,{headers:{"accept":"application/json","user-agent":"Mozilla/5.0 GN-PIVOT/1.0"},signal:AbortSignal.timeout(FETCH_TIMEOUT_MS)});
      if(!r.ok){lastError=`HTTP ${r.status}`;continue;}
      const j=await r.json();
      const result=j?.chart?.result?.[0];
      if(!result){lastError=String(j?.chart?.error?.description||"empty quote");continue;}
      let q=lastFiniteQuote(result);
      const metaPrice=Number(result?.meta?.regularMarketPrice),metaTs=Number(result?.meta?.regularMarketTime);
      if(Number.isFinite(metaPrice)&&Number.isFinite(metaTs)&&(!q||metaTs>=q.ts))q={price:metaPrice,ts:metaTs};
      if(!q){lastError="no finite quote";continue;}
      const quotedAtMs=q.ts*1000,ageMs=Date.now()-quotedAtMs;
      const fresh=ageMs>=-5*60*1000&&ageMs<=MAX_QUOTE_AGE_MS;
      return {
        symbol,
        price:fresh?q.price:null,
        quotedAt:fresh?new Date(quotedAtMs).toISOString():null,
        fresh,
        source:"COMEX / Yahoo Finance",
        marketState:result?.meta?.marketState||null,
        currency:result?.meta?.currency||"USD",
        exchangeName:result?.meta?.exchangeName||"COMEX",
        ageSeconds:Math.max(0,Math.round(ageMs/1000)),
        error:fresh?null:"stale_or_closed"
      };
    }catch(e){lastError=String(e?.message||e);}
  }
  return {symbol,price:null,quotedAt:null,fresh:false,source:"COMEX / Yahoo Finance",marketState:null,currency:"USD",exchangeName:"COMEX",ageSeconds:null,error:lastError};
}

async function metalsLive(req,res){
  try{
    const rows=await Promise.all(METALS.map(async m=>({...m,...await fetchYahoo(m.symbol)})));
    res.set("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma","no-cache");
    res.json({ts:new Date().toISOString(),maxAgeSeconds:MAX_QUOTE_AGE_MS/1000,metals:rows});
  }catch(e){
    res.status(500).json({error:String(e?.message||e),metals:[]});
  }
}

const CLIENT_JS=String.raw`(()=>{
  let inFlight=null,lastPayload=null,lastFetchAt=0;
  const money=v=>Number.isFinite(Number(v))?"$"+Number(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})+" / oz":"실시간값 없음";
  const clock=iso=>{if(!iso)return "--";try{return new Date(iso).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"});}catch{return "--";}};
  async function getLive(){
    if(lastPayload&&Date.now()-lastFetchAt<10000)return lastPayload;
    if(inFlight)return inFlight;
    inFlight=fetch("/api/metals/live?t="+Date.now(),{cache:"no-store"}).then(async r=>{if(!r.ok)throw new Error("HTTP "+r.status);const j=await r.json();lastPayload=j;lastFetchAt=Date.now();return j;}).finally(()=>{inFlight=null;});
    return inFlight;
  }
  function makeCard(row){
    const c=document.createElement("div");c.className="gnDDCard gnLiveMetalCard";
    const top=document.createElement("div");top.className="gnDDTop";
    const b=document.createElement("b");b.textContent=row.name+" · "+row.symbol;
    const badge=document.createElement("span");badge.className="gnDDBadge"+(row.fresh?"":" bad");badge.textContent=row.fresh?"실시간":"휴장/실시간 없음";
    top.append(b,badge);c.appendChild(top);
    const meta=document.createElement("div");meta.className="gnDDMeta";
    const p=document.createElement("span");p.append("현재가 ");const ps=document.createElement("strong");ps.textContent=money(row.price);p.appendChild(ps);
    const t=document.createElement("span");t.append("가격시각 ");const ts=document.createElement("strong");ts.textContent=row.fresh?clock(row.quotedAt):"--";t.appendChild(ts);
    meta.append(p,t);c.appendChild(meta);return c;
  }
  async function render(panel){
    if(!panel||panel.hidden)return;
    const title=panel.querySelector(".gnDDTitle")?.textContent?.trim()||"";
    if(!title.startsWith("금 "))return;
    const old=panel.querySelector("#gnLiveMetalsBlock");if(old)old.remove();
    const list=panel.querySelector(".gnDDList");if(!list)return;
    const block=document.createElement("div");block.id="gnLiveMetalsBlock";block.className="gnDDList";
    const loading=document.createElement("div");loading.className="gnDDCard";loading.textContent="금·은 실시간 가격 확인 중";block.appendChild(loading);list.prepend(block);
    try{
      const j=await getLive();
      if(!panel.isConnected||panel.hidden||!(panel.querySelector(".gnDDTitle")?.textContent||"").startsWith("금 "))return;
      block.replaceChildren();
      for(const row of (j.metals||[]))block.appendChild(makeCard(row));
      if(!block.children.length){const c=document.createElement("div");c.className="gnDDCard";c.textContent="금·은 실시간값 없음";block.appendChild(c);}
    }catch{
      loading.textContent="금·은 실시간값 확인 실패";
    }
  }
  function bind(){
    const root=document.getElementById("moneyRotationSection");if(!root||root.dataset.metalsLiveV1)return;root.dataset.metalsLiveV1="1";
    const observer=new MutationObserver(()=>{const p=document.getElementById("rotationDrilldownV2");if(p&&!p.hidden&&(p.querySelector(".gnDDTitle")?.textContent||"").startsWith("금 ")&&!p.querySelector("#gnLiveMetalsBlock"))render(p);});
    observer.observe(root,{childList:true,subtree:true,characterData:true});
    root.addEventListener("click",e=>{const row=e.target.closest(".rotationRow:not(.rotationHead)");if(row&&row.querySelector("b")?.textContent?.trim()==="금")setTimeout(()=>{render(document.getElementById("rotationDrilldownV2"));},0);});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind,{once:true});else bind();
})();`;

function clientJs(req,res){res.set("Cache-Control","no-store");res.type("application/javascript; charset=utf-8").send(CLIENT_JS);}
function patchHtml(html){if(typeof html!=="string"||!html.includes("<title>GN PIVOT</title>")||html.includes("metals-live-v1.js"))return html;return html.replace("</body>",'<script src="/assets/metals-live-v1.js" defer></script></body>');}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.get("/api/metals/live",metalsLive);
  app.get("/assets/metals-live-v1.js",clientJs);
  app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});
  return app;
}
Object.assign(wrappedExpress,previousExpress);require.cache[expressPath].exports=wrappedExpress;
