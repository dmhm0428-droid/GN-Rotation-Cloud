const SPOT_BASE = "https://data-api.binance.vision";
const FUTURES_BASE = "https://fapi.binance.com";
const BYBIT_BASE = "https://api.bybit.com";

const STABLE_BASE = new Set(["USDT","USDC","FDUSD","TUSD","USDP","DAI","BUSD","EUR","AEUR","TRY","BRL"]);
const LEVERAGED_SUFFIX = /(UP|DOWN|BULL|BEAR)$/;
const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,x));
const median=a=>{
  if(!a.length)return null;
  const x=[...a].sort((p,q)=>p-q), m=Math.floor(x.length/2);
  return x.length%2?x[m]:(x[m-1]+x[m])/2;
};

async function fetchJson(url, opts={}){
  const ac=new AbortController();
  const timer=setTimeout(()=>ac.abort(),10000);
  try{
    const r=await fetch(url,{...opts,signal:ac.signal,headers:{"User-Agent":"GN-Rotation-Market-v6","accept":"application/json",...(opts.headers||{})}});
    if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}
async function retry(fn,n=1){
  let e;
  for(let i=0;i<=n;i++){
    try{return await fn();}catch(err){e=err;if(i<n)await new Promise(r=>setTimeout(r,400*(i+1)));}
  }
  throw e;
}
function validUsdtSymbol(symbol){
  if(!symbol?.endsWith("USDT"))return false;
  const base=symbol.slice(0,-4);
  if(STABLE_BASE.has(base))return false;
  if(LEVERAGED_SUFFIX.test(base))return false;
  return true;
}
function bybitList(payload,label){
  if(payload?.retCode!==0)throw new Error(`${label} retCode ${payload?.retCode}: ${payload?.retMsg||"unknown"}`);
  const rows=payload?.result?.list;
  if(!Array.isArray(rows))throw new Error(`${label} empty`);
  return rows;
}

async function spotBreadth(){
  const rows=await retry(()=>fetchJson(`${SPOT_BASE}/api/v3/ticker/24hr`));
  const parsed=(rows||[]).filter(x=>validUsdtSymbol(x.symbol)).map(x=>({
    symbol:x.symbol,
    change:+x.priceChangePercent,
    quoteVolume:+x.quoteVolume,
    last:+x.lastPrice
  })).filter(x=>Number.isFinite(x.change)&&Number.isFinite(x.quoteVolume));

  parsed.sort((a,b)=>b.quoteVolume-a.quoteVolume);
  const liquid=parsed.slice(0,100);
  const liquid50=parsed.slice(0,50);
  const adv=a=>a.length?a.filter(x=>x.change>0).length/a.length:null;
  const vw=a=>{
    const v=a.reduce((s,x)=>s+x.quoteVolume,0);
    return v?a.reduce((s,x)=>s+x.change*x.quoteVolume,0)/v:null;
  };
  const movers=liquid.slice().sort((a,b)=>b.change-a.change);
  return {
    universe:parsed.length,
    breadth100:adv(liquid),
    breadth50:adv(liquid50),
    median100:median(liquid.map(x=>x.change)),
    volumeWeighted100:vw(liquid),
    totalQuoteVolume100:liquid.reduce((s,x)=>s+x.quoteVolume,0),
    leaders:movers.slice(0,5).map(x=>({symbol:x.symbol.replace("USDT",""),change:x.change,volume:x.quoteVolume})),
    laggards:movers.slice(-5).reverse().map(x=>({symbol:x.symbol.replace("USDT",""),change:x.change,volume:x.quoteVolume}))
  };
}

async function fundingBreadthBinance(){
  const rows=await retry(()=>fetchJson(`${FUTURES_BASE}/fapi/v1/premiumIndex`));
  const parsed=(rows||[]).filter(x=>validUsdtSymbol(x.symbol)).map(x=>(+x.lastFundingRate)).filter(Number.isFinite);
  if(!parsed.length)throw new Error("binance futures funding empty");
  return {
    count:parsed.length,
    positive:parsed.filter(x=>x>0).length/parsed.length,
    median:median(parsed),
    hot:parsed.filter(x=>Math.abs(x)>=0.0005).length/parsed.length,
    veryHot:parsed.filter(x=>Math.abs(x)>=0.001).length/parsed.length,
    source:"binance"
  };
}

async function fundingBreadthBybit(){
  const payload=await retry(()=>fetchJson(`${BYBIT_BASE}/v5/market/tickers?category=linear`));
  const rows=bybitList(payload,"bybit tickers");
  const parsed=rows.filter(x=>validUsdtSymbol(x.symbol)).map(x=>+x.fundingRate).filter(Number.isFinite);
  if(!parsed.length)throw new Error("bybit futures funding empty");
  return {
    count:parsed.length,
    positive:parsed.filter(x=>x>0).length/parsed.length,
    median:median(parsed),
    hot:parsed.filter(x=>Math.abs(x)>=0.0005).length/parsed.length,
    veryHot:parsed.filter(x=>Math.abs(x)>=0.001).length/parsed.length,
    source:"bybit"
  };
}

async function fundingBreadth(){
  try{return await fundingBreadthBinance();}
  catch{return fundingBreadthBybit();}
}

async function latestFundingFromSupabase(){
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("supabase fallback env missing");
  const rows=await fetchJson(`${url}/rest/v1/gn_market_snapshots?select=funding_positive,funding_median,funding_hot,ts&order=ts.desc&limit=1`,{
    headers:{apikey:key,Authorization:`Bearer ${key}`}
  });
  const r=Array.isArray(rows)?rows[0]:null;
  if(!r||r.funding_hot==null)throw new Error("supabase funding fallback empty");
  const hot=Number(r.funding_hot);
  const med=Number(r.funding_median);
  const positive=Number(r.funding_positive);
  if(!Number.isFinite(hot))throw new Error("supabase funding fallback invalid");
  return {
    count:null,
    positive:Number.isFinite(positive)?positive:null,
    median:Number.isFinite(med)?med:null,
    hot,
    veryHot:null,
    source:"supabase_cache",
    cachedAt:r.ts
  };
}

async function takerRatioBinance(symbol="BTCUSDT"){
  const rows=await retry(()=>fetchJson(`${FUTURES_BASE}/futures/data/takerlongshortRatio?symbol=${symbol}&period=5m&limit=12`));
  if(!Array.isArray(rows)||!rows.length)throw new Error("binance taker ratio empty");
  const recent=rows.slice(-3).map(x=>+x.buySellRatio).filter(Number.isFinite);
  return {current:+rows.at(-1).buySellRatio,avg15m:recent.reduce((a,b)=>a+b,0)/(recent.length||1),source:"binance"};
}

async function takerRatioBybit(symbol="BTCUSDT"){
  const payload=await retry(()=>fetchJson(`${BYBIT_BASE}/v5/market/recent-trade?category=linear&symbol=${encodeURIComponent(symbol)}&limit=1000`));
  const rows=bybitList(payload,"bybit recent trades");
  if(!rows.length)throw new Error("bybit recent trades empty");
  const now=Date.now(), cutoff=now-15*60*1000;
  let buy=0,sell=0,used=0;
  for(const r of rows){
    const t=Number(r.time),size=Number(r.size),price=Number(r.price);
    if(!Number.isFinite(t)||!Number.isFinite(size)||!Number.isFinite(price)||t<cutoff)continue;
    const notional=size*price;
    if(r.side==="Buy")buy+=notional;
    else if(r.side==="Sell")sell+=notional;
    used++;
  }
  if(!used){
    for(const r of rows.slice(0,200)){
      const size=Number(r.size),price=Number(r.price);
      if(!Number.isFinite(size)||!Number.isFinite(price))continue;
      const notional=size*price;
      if(r.side==="Buy")buy+=notional;
      else if(r.side==="Sell")sell+=notional;
      used++;
    }
  }
  if(!used||sell<=0)throw new Error("bybit taker ratio insufficient trades");
  const ratio=buy/sell;
  return {current:ratio,avg15m:ratio,source:"bybit",tradeCount:used};
}

async function takerRatio(symbol="BTCUSDT"){
  try{return await takerRatioBinance(symbol);}
  catch{return takerRatioBybit(symbol);}
}

function scoreMarket({spot,funding,taker,btc,macroScore=5}){
  // 0~100. 50 = neutral. This is an explainable risk/participation score, not a price forecast.
  let breadth=50;
  if(spot){
    breadth += ((spot.breadth100??0.5)-0.5)*70;
    breadth += Math.max(-15,Math.min(15,(spot.median100||0)*3));
    breadth += Math.max(-10,Math.min(10,(spot.volumeWeighted100||0)*1.2));
  }
  breadth=clamp(breadth);

  let leverage=50;
  if(funding){
    leverage -= Math.max(0,(funding.hot-0.10))*130;
    if(funding.veryHot!=null)leverage -= Math.max(0,(funding.veryHot-0.03))*160;
    if(funding.median!=null && Math.abs(funding.median)<0.00015)leverage+=8;
  }
  leverage=clamp(leverage);

  let flow=50;
  if(taker?.avg15m)flow += Math.max(-25,Math.min(25,(taker.avg15m-1)*45));
  if(btc?.r1!=null)flow += Math.max(-15,Math.min(15,btc.r1*250));
  flow=clamp(flow);

  const macro=clamp((macroScore??5)*10);
  let total=clamp(breadth*.40+leverage*.20+flow*.25+macro*.15);
  const reasons=[];

  const btc24=(btc?.r24??0)*100;
  if(btc24<=-4){total=Math.min(total,34);reasons.push(`BTC 24h ${btc24.toFixed(1)}% 급락`);}
  if(spot?.breadth100!=null && spot.breadth100<0.30){total=Math.min(total,32);reasons.push(`상승 종목 비율 ${(spot.breadth100*100).toFixed(0)}%로 시장 폭 약함`);}
  if(funding?.hot!=null && funding.hot>0.25){total=Math.min(total,48);reasons.push(`과열 펀딩 종목 ${(funding.hot*100).toFixed(0)}%`);}
  if(taker?.avg15m<0.92)reasons.push(`BTC 선물 매도 체결 우위 ${taker.avg15m.toFixed(2)}`);
  if(taker?.avg15m>1.08)reasons.push(`BTC 선물 매수 체결 우위 ${taker.avg15m.toFixed(2)}`);
  if(spot?.breadth100>0.65)reasons.push(`상승 종목 비율 ${(spot.breadth100*100).toFixed(0)}%로 확산`);
  if((spot?.median100||0)>1)reasons.push(`상위 100개 중앙값 +${spot.median100.toFixed(1)}%`);

  let action="관찰";
  let regime="중립";
  if(total<30){action="매수금지";regime="위험회피";}
  else if(total<45){action="대기";regime="약세";}
  else if(total<60){action="관찰";regime="혼조";}
  else if(total<72){action="확인매수";regime="위험선호 전환";}
  else {action="추가매수";regime="시장 확산";}

  // Overheat can override a high breadth score: participate, but do not chase.
  if(funding?.hot>0.35 && total>=60){action="추격금지";regime="강세·레버리지 과열";}

  if(!reasons.length)reasons.push("시장 폭·레버리지·체결 흐름이 중립권");
  return {score:+total.toFixed(1),action,regime,reasons:reasons.slice(0,4),components:{breadth:+breadth.toFixed(1),leverage:+leverage.toFixed(1),flow:+flow.toFixed(1),macro:+macro.toFixed(1)}};
}

async function collectLiveMarket({btc=null,macroScore=5}={}){
  const parts=await Promise.allSettled([spotBreadth(),fundingBreadth(),takerRatio("BTCUSDT"),takerRatio("ETHUSDT")]);
  const [s,f,b,e]=parts;
  const spot=s.status==="fulfilled"?s.value:null;
  let funding=f.status==="fulfilled"?f.value:null;
  const btcTaker=b.status==="fulfilled"?b.value:null;
  const ethTaker=e.status==="fulfilled"?e.value:null;
  const errors={};
  if(!spot)errors.spot=String(s.reason?.message||s.reason);
  if(!funding){
    errors.funding=String(f.reason?.message||f.reason);
    try{
      funding=await latestFundingFromSupabase();
      errors.fundingFallback="supabase_cache";
    }catch(err){
      errors.fundingFallback=String(err?.message||err);
    }
  }
  if(!btcTaker)errors.btcTaker=String(b.reason?.message||b.reason);
  if(!ethTaker)errors.ethTaker=String(e.reason?.message||e.reason);
  const decision=scoreMarket({spot,funding,taker:btcTaker,btc,macroScore});
  const quality=[spot,funding,btcTaker,ethTaker].filter(Boolean).length/4;
  return {ts:new Date().toISOString(),spot,funding,btcTaker,ethTaker,decision,quality,errors};
}

module.exports={collectLiveMarket,scoreMarket,fetchJson};
