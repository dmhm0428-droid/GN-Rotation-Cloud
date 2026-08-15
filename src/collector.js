
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.");
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const COINS = ["BTC","ETH","SOL","LINK"];
const SYMBOLS = {
  BTC:{upbit:"KRW-BTC",binance:"BTCUSDT",coinbase:"BTC-USD"},
  ETH:{upbit:"KRW-ETH",binance:"ETHUSDT",coinbase:"ETH-USD"},
  SOL:{upbit:"KRW-SOL",binance:"SOLUSDT",coinbase:"SOL-USD"},
  LINK:{upbit:"KRW-LINK",binance:"LINKUSDT",coinbase:"LINK-USD"}
};

const clamp=(x,a=0,b=10)=>Math.max(a,Math.min(b,x));
const pct=(a,b)=>b ? a/b-1 : null;
const now=()=>Date.now();

async function fetchJson(url, opts={}){
  const ac=new AbortController();
  const timer=setTimeout(()=>ac.abort(), 12000);
  try{
    const r=await fetch(url,{
      ...opts, signal:ac.signal,
      headers:{"User-Agent":"GN-Rotation-Cloud-v4","accept":"application/json",...(opts.headers||{})}
    });
    if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}
async function fetchText(url){
  const ac=new AbortController(); const timer=setTimeout(()=>ac.abort(),12000);
  try{
    const r=await fetch(url,{signal:ac.signal,headers:{"User-Agent":"GN-Rotation-Cloud-v4"}});
    if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.text();
  } finally { clearTimeout(timer); }
}
async function retry(fn, n=2){
  let e;
  for(let i=0;i<=n;i++){
    try{return await fn();}
    catch(err){e=err; if(i<n) await new Promise(r=>setTimeout(r,500*(i+1)));}
  }
  throw e;
}

async function upbitTicker(market){
  const j=await retry(()=>fetchJson(`https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(market)}`));
  const x=j[0];
  return {price:+x.trade_price,chg24:+(x.signed_change_rate||0),vol24krw:+(x.acc_trade_price_24h||0)};
}
async function binanceKlines(symbol){
  const j=await retry(()=>fetchJson(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=26`));
  const c=j.map(x=>+x[4]), p=c.at(-1);
  return {price:p,r1:pct(p,c.at(-2)),r4:pct(p,c.at(-5)),r24:pct(p,c.at(-25))};
}

// 15분 구간을 가능한 한 끝까지 페이지 순회.
// 같은 millisecond 중복은 aggregate trade id로 제거.
async function binanceCvd15m(symbol){
  const end=now(), start=end-15*60*1000;
  let cursor=start, pages=0, rows=[], seen=new Set(), complete=true;
  const MAX_PAGES=40;
  while(cursor<=end && pages<MAX_PAGES){
    const j=await retry(()=>fetchJson(
      `https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&startTime=${cursor}&endTime=${end}&limit=1000`
    ),1);
    pages++;
    if(!Array.isArray(j) || j.length===0) break;
    let maxT=cursor;
    for(const t of j){
      const id=String(t.a);
      if(!seen.has(id)){
        seen.add(id); rows.push(t);
      }
      maxT=Math.max(maxT,+t.T);
    }
    if(j.length<1000 || maxT>=end) break;
    if(maxT<=cursor){ complete=false; break; }
    cursor=maxT; // same-ms duplicates are deduped next page
  }
  if(pages>=MAX_PAGES) complete=false;
  let buy=0,sell=0;
  for(const t of rows){
    const n=+t.p * +t.q;
    if(t.m) sell+=n; else buy+=n;
  }
  const total=buy+sell;
  return {ratio:total?(buy-sell)/total:0,count:rows.length,complete,pages};
}
async function coinbaseTicker(product){
  const j=await retry(()=>fetchJson(`https://api.exchange.coinbase.com/products/${product}/ticker`));
  return {price:+j.price};
}
async function futuresData(symbol){
  const [oi,prem]=await Promise.all([
    retry(()=>fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`)),
    retry(()=>fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`))
  ]);
  return {oi:+oi.openInterest,funding:+(prem.lastFundingRate||0)};
}
async function globalCrypto(){
  const j=await retry(()=>fetchJson("https://api.coingecko.com/api/v3/global"));
  const d=+j.data.market_cap_percentage.btc;
  if(!Number.isFinite(d)||d<10||d>90) throw new Error(`BTC dominance abnormal: ${d}`);
  return {btcDom:d};
}
function parseFred(csv){
  return csv.trim().split(/\r?\n/).slice(1).map(line=>{
    const [d,v]=line.split(","); return {d,v:+v};
  }).filter(x=>Number.isFinite(x.v));
}
async function fred(id){
  const t=await retry(()=>fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`));
  const a=parseFred(t), x=a.at(-1), y=a.at(-2);
  return {value:x?.v??null,change:(x&&y)?x.v-y.v:null,date:x?.d??null};
}
async function macroData(){
  const [d2,d10,dollar,vix,nasdaq,usdJpy]=await Promise.all([
    fred("DGS2"),fred("DGS10"),fred("DTWEXBGS"),fred("VIXCLS"),fred("NASDAQCOM"),fred("DEXJPUS")
  ]);
  return {d2,d10,dollar,vix,nasdaq,usdJpy};
}
function macroScore(m){
  let s=5;
  if(m.d10.change!=null)s+=m.d10.change<=-0.03?1:m.d10.change>=0.03?-1:0;
  if(m.d2.change!=null)s+=m.d2.change<=-0.03?.5:m.d2.change>=0.03?-.5:0;
  if(m.dollar.change!=null)s+=m.dollar.change<0?.5:m.dollar.change>0?-.5:0;
  if(m.vix.change!=null)s+=m.vix.change<0?.5:m.vix.change>1?-.75:0;
  if(m.nasdaq.change!=null)s+=m.nasdaq.change>0?.5:m.nasdaq.change<0?-.25:0;
  if(m.usdJpy.change!=null && Math.abs(m.usdJpy.change)>=1)s-=.5;
  return clamp(s);
}

async function recentSnapshots(hours=3){
  const since=new Date(Date.now()-hours*3600*1000).toISOString();
  const {data,error}=await db.from("gn_snapshots")
    .select("ts,coin,score,oi,btc_dominance")
    .gte("ts",since).order("ts",{ascending:true});
  if(error) throw error;
  return data||[];
}
function nearest(rows, coin, targetMs, toleranceMs){
  let best=null, diff=Infinity;
  for(const r of rows){
    if(r.coin!==coin) continue;
    const d=Math.abs(new Date(r.ts).getTime()-targetMs);
    if(d<diff){diff=d;best=r;}
  }
  return diff<=toleranceMs?best:null;
}
function nearestAny(rows,targetMs,toleranceMs){
  let best=null,diff=Infinity;
  for(const r of rows){
    const d=Math.abs(new Date(r.ts).getTime()-targetMs);
    if(d<diff){diff=d;best=r;}
  }
  return diff<=toleranceMs?best:null;
}
async function getOverlay(){
  const {data}=await db.from("gn_overlays").select("*").eq("id",1).maybeSingle();
  return data||{etf:{BTC:5,ETH:5,SOL:5,LINK:5},events:{BTC:5,ETH:5,SOL:5,LINK:5},note:"neutral"};
}

function rsScore(coin,k,btc){
  if(coin==="BTC")return clamp(5+(k.r4||0)*40+(k.r24||0)*18);
  return clamp(5+((k.r4||0)-(btc.r4||0))*65+((k.r24||0)-(btc.r24||0))*28);
}
function spotScore(cvd,prem,up24){
  let s=5;
  if(cvd>.08)s+=1.5; else if(cvd>.02)s+=.7; else if(cvd<-.08)s-=1.5; else if(cvd<-.02)s-=.7;
  if(prem>.001)s+=.6; else if(prem<-.001)s-=.6;
  if(up24>0&&up24<.05)s+=.3;
  if(up24>.07)s-=.7;
  return clamp(s);
}
function levScore(funding,oi15,oi1h){
  let s=5, o=oi15??oi1h, f=Math.abs(funding||0);
  if(o!=null&&o>0&&o<.05&&f<.0003)s+=1;
  if(o!=null&&o>=.08)s-=1.2;
  if(f>=.0005)s-=1.5;
  if(f<.0001)s+=.4;
  return clamp(s);
}
function instScore(prem,etf){
  let p=5;
  if(prem>.0015)p=7; else if(prem>.0005)p=6.1; else if(prem<-.0015)p=3; else if(prem<-.0005)p=4;
  return clamp(p*.6 + +(etf??5)*.4);
}
function stageOf(r,warmup){
  if(warmup || r.quality<0.80)return {stage:"축적",chase:false};
  if(r.r1>=.06 || (r.oi15!=null&&r.oi15>=.10) || Math.abs(r.funding)>=.0007)return {stage:"과열",chase:true};
  if(r.score>=7.4&&r.rs4>0&&r.rs24>0&&r.cvd15>0&&r.deltaScore15>0)return {stage:"본회전",chase:false};
  if(r.score>=6.4&&r.rs4>=0&&r.cvd15>=0&&r.deltaScore15>0)return {stage:"선발대",chase:false};
  return {stage:"준비",chase:false};
}

async function main(){
  const started=new Date();
  const runId=crypto.randomUUID();
  await db.from("gn_runs").insert({id:runId,started_at:started.toISOString(),status:"running"});

  try{
    const history=await recentSnapshots(3);
    const overlay=await getOverlay();
    const t=Date.now();
    const [g,macro]=await Promise.all([globalCrypto(),macroData()]);
    const mScore=macroScore(macro);
    const raw={}, sourceStatus={};

    for(const coin of COINS){
      const s=SYMBOLS[coin], errors={};
      const parts=await Promise.allSettled([
        upbitTicker(s.upbit),binanceKlines(s.binance),binanceCvd15m(s.binance),
        coinbaseTicker(s.coinbase),futuresData(s.binance)
      ]);
      const names=["upbit","klines","cvd","coinbase","futures"];
      const o={};
      parts.forEach((p,i)=>{
        if(p.status==="fulfilled")o[names[i]]=p.value;
        else errors[names[i]]=String(p.reason?.message||p.reason);
      });
      raw[coin]={...o,errors};
      sourceStatus[coin]={ok:Object.keys(errors).length===0,errors};
    }

    if(!raw.BTC.upbit||!raw.BTC.klines)throw new Error("BTC 핵심 기준데이터(Upbit/Binance Klines) 실패");

    const prev15Any=nearestAny(history,t-15*60*1000,9*60*1000);
    const prev1hAny=nearestAny(history,t-60*60*1000,22*60*1000);
    const dom15=prev15Any?.btc_dominance!=null ? g.btcDom-(+prev15Any.btc_dominance) : null;
    const dom1h=prev1hAny?.btc_dominance!=null ? g.btcDom-(+prev1hAny.btc_dominance) : null;
    const results=[];

    for(const coin of COINS){
      const x=raw[coin], errs=x.errors||{};
      if(!x.upbit||!x.klines)continue;

      const p15=nearest(history,coin,t-15*60*1000,9*60*1000);
      const p1h=nearest(history,coin,t-60*60*1000,22*60*1000);
      const oi15=x.futures&&p15?.oi ? pct(x.futures.oi,+p15.oi) : null;
      const oi1h=x.futures&&p1h?.oi ? pct(x.futures.oi,+p1h.oi) : null;
      const deltaScore15=p15?.score!=null ? null : null; // score known after compute; set below
      const premium=x.coinbase ? pct(x.coinbase.price,x.klines.price) : 0;
      const cvd=x.cvd?.ratio??0;
      const rs=rsScore(coin,x.klines,raw.BTC.klines);
      const spot=spotScore(cvd,premium,x.upbit.chg24);
      const lev=levScore(x.futures?.funding??0,oi15,oi1h);
      const inst=instScore(premium,overlay.etf?.[coin]);
      const evt=clamp(+(overlay.events?.[coin]??5));

      let domAdj=0;
      if(coin!=="BTC"){
        if(dom15!=null)domAdj+=dom15<=-.15?.25:dom15>=.15?-.25:0;
        if(dom1h!=null)domAdj+=dom1h<=-.30?.25:dom1h>=.30?-.25:0;
      }

      let score=clamp(rs*.25+spot*.20+lev*.15+inst*.15+mScore*.15+evt*.10+domAdj);

      // data quality: core 5 feeds + global/macro, CVD completeness separately.
      let q=1;
      const failCount=Object.keys(errs).length;
      q-=failCount*.12;
      if(x.cvd && !x.cvd.complete)q-=.12;
      q=clamp(q,0,1);

      const dScore=p15?.score!=null ? score-(+p15.score) : null;
      const rs4=coin==="BTC"?x.klines.r4:x.klines.r4-raw.BTC.klines.r4;
      const rs24=coin==="BTC"?x.klines.r24:x.klines.r24-raw.BTC.klines.r24;
      const r={coin,score,quality:q,r1:x.klines.r1,rs4,rs24,cvd15:cvd,
        cvdComplete:x.cvd?.complete??false,aggCount:x.cvd?.count??0,
        oi:x.futures?.oi??null,oi15,oi1h,funding:x.futures?.funding??0,
        premium,btcDom:g.btcDom,dom15,dom1h,macroScore:mScore,deltaScore15:dScore,
        krw:x.upbit.price,usd:x.klines.price,components:{rs,spot,lev,inst,macro:mScore,event:evt},errors:errs};
      const warmup=!p15 || !p1h;
      Object.assign(r,stageOf(r,warmup));
      results.push(r);
    }

    results.sort((a,b)=>b.score-a.score);
    const inserted=[];
    for(let i=0;i<results.length;i++){
      const r=results[i];
      const row={
        run_id:runId,ts:new Date().toISOString(),coin:r.coin,rank:i+1,score:r.score,stage:r.stage,chase:r.chase,
        krw_price:r.krw,usd_price:r.usd,rs4:r.rs4,rs24:r.rs24,cvd15:r.cvd15,cvd_complete:r.cvdComplete,
        aggtrade_count:r.aggCount,oi:r.oi,oi15:r.oi15,oi1h:r.oi1h,funding:r.funding,
        coinbase_premium_proxy:r.premium,btc_dominance:r.btcDom,dom15_pp:r.dom15,dom1h_pp:r.dom1h,
        macro_score:r.macroScore,delta_score15:r.deltaScore15,data_quality:r.quality,
        components:r.components,source_errors:r.errors
      };
      const {data,error}=await db.from("gn_snapshots").insert(row).select("id").single();
      if(error)throw error;
      inserted.push({...r,id:data.id,rank:i+1});

      if((r.stage==="선발대"||r.stage==="본회전") && !r.chase && r.quality>=.80){
        const msg=`${r.coin} ${r.stage} | 점수 ${r.score.toFixed(2)} | ΔScore15 ${r.deltaScore15?.toFixed(2)??"N/A"} | 품질 ${(r.quality*100).toFixed(0)}%`;
        await db.from("gn_alerts").insert({coin:r.coin,level:r.stage,score:r.score,stage:r.stage,message:msg,snapshot_id:data.id});
      }
    }

    await db.from("gn_runs").update({
      finished_at:new Date().toISOString(),status:"success",btc_dominance:g.btcDom,macro_score:mScore,source_status:sourceStatus
    }).eq("id",runId);

    console.log(JSON.stringify({ok:true,runId,top:inserted.map(x=>({rank:x.rank,coin:x.coin,score:x.score,stage:x.stage,quality:x.quality}))},null,2));
  } catch(e){
    await db.from("gn_runs").update({finished_at:new Date().toISOString(),status:"error",error:String(e.stack||e)}).eq("id",runId);
    throw e;
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
