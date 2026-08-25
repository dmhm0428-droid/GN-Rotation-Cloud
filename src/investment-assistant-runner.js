"use strict";

const {createClient}=require("@supabase/supabase-js");

const URL=process.env.SUPABASE_URL;
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!URL||!KEY)throw new Error("Supabase env vars missing");
const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});

const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,x));
const num=x=>Number.isFinite(Number(x))?Number(x):null;
const mean=a=>{const v=(a||[]).map(Number).filter(Number.isFinite);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null;};

async function fetchText(url){
  const ac=new AbortController();
  const timer=setTimeout(()=>ac.abort(),10000);
  try{
    const r=await fetch(url,{signal:ac.signal,headers:{"User-Agent":"GN-Investment-Assistant-v2"}});
    if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
    return await r.text();
  }finally{clearTimeout(timer);}
}

function parseFred(csv){
  return String(csv||"").trim().split(/\r?\n/).slice(1).map(line=>{
    const [date,value]=line.split(",");
    const v=Number(value);
    return {date,value:v};
  }).filter(x=>Number.isFinite(x.value));
}

async function fred(id){
  try{
    const rows=parseFred(await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`));
    const a=rows.at(-1),b=rows.at(-2);
    return {value:a?.value??null,change:(a&&b)?a.value-b.value:null,date:a?.date??null};
  }catch(error){return {value:null,change:null,date:null,error:String(error.message||error)};}
}

function ymd(d){return d.toISOString().slice(0,10).replaceAll("-","");}
function parseStooq(csv){
  return String(csv||"").trim().split(/\r?\n/).slice(1).map(line=>{
    const [date,open,high,low,close,volume]=line.split(",");
    return {date,open:num(open),high:num(high),low:num(low),close:num(close),volume:num(volume)};
  }).filter(x=>x.date&&x.close>0).sort((a,b)=>a.date.localeCompare(b.date));
}
async function stooq(symbol){
  try{
    const end=new Date(),start=new Date(Date.now()-45*86400000);
    const text=await fetchText(`https://stooq.com/q/d/l/?s=${encodeURIComponent(String(symbol).toLowerCase())}&d1=${ymd(start)}&d2=${ymd(end)}&i=d`);
    const rows=parseStooq(text);
    if(rows.length<8)throw new Error("insufficient rows");
    return {symbol,rows};
  }catch(error){return {symbol,rows:[],error:String(error.message||error)};}
}

async function loadLatest(){
  const [{data:snapshots,error:snapErr},{data:market,error:marketErr},{data:overlay,error:overlayErr}]=await Promise.all([
    db.from("gn_snapshots").select("*").order("ts",{ascending:false}).limit(48),
    db.from("gn_market_snapshots").select("*").order("ts",{ascending:false}).limit(1).maybeSingle(),
    db.from("gn_overlays").select("*").eq("id",1).maybeSingle()
  ]);
  if(snapErr)throw snapErr;
  const latest={};
  for(const row of snapshots||[])if(!latest[row.coin])latest[row.coin]=row;
  return {coins:Object.values(latest),market:marketErr?null:market,overlay:overlayErr?null:overlay};
}

function debasementScore({gold,dollar,d30,btc,overlay}){
  let s=50;
  const goldUp=num(gold?.change),dollarChg=num(dollar?.change),d30Chg=num(d30?.change),btc24=num(btc?.rs24);
  if(goldUp!=null)s+=goldUp>0?10:goldUp<0?-7:0;
  if(dollarChg!=null)s+=dollarChg<0?10:dollarChg>0?-10:0;
  if(d30Chg!=null)s+=d30Chg>=0.04?7:d30Chg<=-0.04?-2:0;
  if(btc24!=null)s+=btc24>0?10:btc24<0?-10:0;
  if(goldUp>0&&btc24>0)s+=8;
  const etf=num(overlay?.etf?.BTC);
  if(etf!=null)s+=(etf-5)*2.5;
  return +clamp(s).toFixed(1);
}

function liquidityScore({coins,market}){
  const btc=coins.find(x=>x.coin==="BTC"),eth=coins.find(x=>x.coin==="ETH");
  let s=50;
  if(num(btc?.rs24)!=null)s+=btc.rs24>0?10:-10;
  if(num(eth?.rs24)!=null)s+=eth.rs24>0?12:eth.rs24<0?-8:0;
  if(num(btc?.dom1h_pp)!=null)s+=btc.dom1h_pp<0?8:btc.dom1h_pp>0?-6:0;
  const breadth=num(market?.spot_breadth100);
  if(breadth!=null)s+=breadth>=0.60?12:breadth<=0.40?-12:0;
  const btcTaker=num(market?.btc_taker_ratio),ethTaker=num(market?.eth_taker_ratio);
  if(btcTaker!=null)s+=btcTaker>0?5:btcTaker<0?-5:0;
  if(ethTaker!=null)s+=ethTaker>0?5:ethTaker<0?-5:0;
  return +clamp(s).toFixed(1);
}

function catchupScore(row){
  let s=50;
  const rs4=num(row.rs4),rs24=num(row.rs24),cvd=num(row.cvd15),funding=Math.abs(num(row.funding)||0);
  if(row.coin==="BTC"){
    if(rs4!=null)s+=rs4>0?8:-8;if(rs24!=null)s+=rs24>0?8:-8;
  }else{
    if(rs24!=null&&rs24<0)s+=Math.min(14,Math.abs(rs24)*250);
    if(rs4!=null&&rs4>0)s+=Math.min(16,rs4*350);
    if(rs24!=null&&rs24>0.08)s-=12;
  }
  if(cvd!=null)s+=cvd>0.02?10:cvd<-0.02?-10:0;
  if(funding<0.0003)s+=5;
  if(row.chase||row.stage==="과열")s-=25;
  return +clamp(s).toFixed(1);
}

function decide(row,regime,liquidity){
  const quality=num(row.data_quality)??0,base=clamp((num(row.score)??0)*10),catchup=catchupScore(row);
  const score=clamp(base*0.45+regime*0.25+liquidity*0.20+catchup*0.10);
  const hardBlock=quality<0.80||row.chase===true||row.stage==="과열"||Math.abs(num(row.funding)||0)>=0.0007;
  let action="WAIT";
  if(hardBlock)action=row.chase||row.stage==="과열"?"NO_CHASE":"WAIT";
  else if(score>=75&&num(row.cvd15)>0&&(num(row.delta_score15)??0)>=0)action="ENTRY_READY";
  else if(score>=65)action="SCOUT";
  const reason=[];
  if(regime>=70)reason.push("화폐희석 레짐 강함");
  if(liquidity>=65)reason.push("BTC→알트 유동성 확산");
  if(catchup>=65)reason.push("상대가치 캐치업 후보");
  if(num(row.cvd15)>0.02)reason.push("현물 CVD 양호");
  if(row.chase||row.stage==="과열")reason.push("추격금지");
  if(quality<0.80)reason.push("데이터 품질 부족");
  return {coin:row.coin,score:+score.toFixed(1),action,catchup,quality,reason:reason.slice(0,3),snapshotId:row.id};
}

function equityMetrics(feed,benchmark){
  const rows=feed?.rows||[],bench=benchmark?.rows||[];
  if(rows.length<8||bench.length<8)return null;
  const c=rows.at(-1).close,c1=rows.at(-2).close,c5=rows.at(-6).close;
  const b=bench.at(-1).close,b1=bench.at(-2).close,b5=bench.at(-6).close;
  const r1=c/c1-1,r5=c/c5-1,br1=b/b1-1,br5=b/b5-1;
  const recentLow=Math.min(...rows.slice(-3).map(x=>x.low).filter(Number.isFinite));
  const priorLow=Math.min(...rows.slice(-6,-3).map(x=>x.low).filter(Number.isFinite));
  const higherLow=Number.isFinite(recentLow)&&Number.isFinite(priorLow)&&recentLow>=priorLow;
  const vr=mean(rows.slice(-3).map(x=>x.volume)),vp=mean(rows.slice(-6,-3).map(x=>x.volume));
  const volumeAcceleration=vr!=null&&vp>0?vr/vp:null;
  return {r1,r5,rel1:r1-br1,rel5:r5-br5,higherLow,volumeAcceleration,price:c};
}

function cryptoRecovery(row,benchmark24){
  if(!row)return null;
  const r24=num(row.rs24)??0,r4=num(row.rs4)??0,rel24=r24-(benchmark24??0),cvd=num(row.cvd15)??0;
  return {r1:r4,r5:r24,rel1:r4,rel5:rel24,higherLow:(num(row.delta_score15)??0)>=0,volumeAcceleration:null,price:num(row.price),cvd};
}

function groupMetrics(name,members,feeds,benchmark,cryptoRows){
  if(name==="BTC"||name==="ETH"){
    const row=cryptoRows.find(x=>x.coin===name);
    const btc=cryptoRows.find(x=>x.coin==="BTC");
    return cryptoRecovery(row,name==="BTC"?0:(num(btc?.rs24)??0));
  }
  const ms=members.map(s=>equityMetrics(feeds[s],benchmark)).filter(Boolean);
  if(!ms.length)return null;
  return {
    r1:mean(ms.map(x=>x.r1)),r5:mean(ms.map(x=>x.r5)),rel1:mean(ms.map(x=>x.rel1)),rel5:mean(ms.map(x=>x.rel5)),
    higherLow:ms.filter(x=>x.higherLow).length>=Math.ceil(ms.length/2),
    volumeAcceleration:mean(ms.map(x=>x.volumeAcceleration).filter(Number.isFinite)),price:mean(ms.map(x=>x.price))
  };
}

function recoveryScore(name,m,marketWeak){
  if(!m)return {name,score:0,stage:"DATA_WAIT",reasons:["데이터 부족"]};
  let score=35;const reasons=[];
  if(m.rel1>0){score+=14;reasons.push("당일 상대강도 우위");}else if(m.rel1<-.015)score-=10;
  if(m.rel5>0){score+=13;reasons.push("5일 상대강도 우위");}else if(m.rel5<-.03)score-=10;
  if(m.higherLow){score+=15;reasons.push("저점 미갱신/상승");}
  if(Number.isFinite(m.volumeAcceleration)&&m.volumeAcceleration>=1.12){score+=12;reasons.push("거래대금 선행");}
  if(Number.isFinite(m.cvd)&&m.cvd>0.02){score+=12;reasons.push("현물 CVD 회귀");}
  if(marketWeak&&m.r1>=0){score+=10;reasons.push("약한 시장에서 양전");}
  if(marketWeak&&m.r1<0&&m.rel1>0)score+=6;
  score=clamp(score);
  let stage="WAIT";
  if(score>=78&&m.higherLow&&(m.rel1>0||m.rel5>0))stage="ENTRY_EDGE";
  else if(score>=65&&m.higherLow)stage="SCOUT";
  else if(score>=55)stage="WATCH";
  return {name,score:+score.toFixed(1),stage,reasons:reasons.slice(0,4),metrics:{r1:+(m.r1*100).toFixed(2),r5:+(m.r5*100).toFixed(2),rel1:+(m.rel1*100).toFixed(2),rel5:+(m.rel5*100).toFixed(2),higherLow:m.higherLow,volumeAcceleration:Number.isFinite(m.volumeAcceleration)?+m.volumeAcceleration.toFixed(2):null}};
}

async function crossAssetRecovery(coins){
  const symbols=["spy.us","gld.us","vrt.us","gev.us","pwr.us","ita.us","xar.us"];
  const results=await Promise.all(symbols.map(stooq));
  const feeds=Object.fromEntries(results.map(x=>[x.symbol,x]));
  const spy=feeds["spy.us"];
  const groups={
    BTC:[],ETH:[],GOLD:["gld.us"],AI_POWER:["vrt.us","gev.us","pwr.us"],DEFENSE:["ita.us","xar.us"]
  };
  const spyM=equityMetrics(spy,spy);
  const marketWeak=spyM?spyM.r1<0&&spyM.r5<0:false;
  const ranked=Object.entries(groups).map(([name,members])=>recoveryScore(name,groupMetrics(name,members,feeds,spy,coins),marketWeak)).sort((a,b)=>b.score-a.score);
  const leader=ranked[0]||null;
  return {marketWeak,leader,ranked,source:"SPY/GLD/VRT/GEV/PWR/ITA/XAR + GN BTC/ETH"};
}

async function shouldWrite(d){
  const {data}=await db.from("gn_alerts").select("ts,stage,score").eq("coin",d.coin).eq("level","투자비서").order("ts",{ascending:false}).limit(1).maybeSingle();
  if(!data)return true;
  const age=Date.now()-new Date(data.ts).getTime();
  const scoreMoved=Math.abs((num(data.score)??0)-d.score)>=4;
  return data.stage!==d.action||scoreMoved||age>2*60*60*1000;
}

async function writeRecoveryLeader(recovery){
  const l=recovery?.leader;if(!l||!['SCOUT','ENTRY_EDGE'].includes(l.stage))return;
  const coin=`ASSET:${l.name}`;
  const {data}=await db.from("gn_alerts").select("ts,stage,score").eq("coin",coin).eq("level","복귀1등").order("ts",{ascending:false}).limit(1).maybeSingle();
  const changed=!data||data.stage!==l.stage||Math.abs((num(data.score)??0)-l.score)>=4||Date.now()-new Date(data.ts).getTime()>2*60*60*1000;
  if(!changed)return;
  const m=l.metrics||{};
  const msg=`복귀 1등 ${l.name} ${l.stage} | ${l.score.toFixed(1)} | 상대강도 1D ${m.rel1>=0?'+':''}${m.rel1?.toFixed?.(1)??m.rel1}% · 5D ${m.rel5>=0?'+':''}${m.rel5?.toFixed?.(1)??m.rel5}% | ${l.reasons.join(" · ")}`;
  const {error}=await db.from("gn_alerts").insert({coin,level:"복귀1등",score:l.score,stage:l.stage,message:msg});
  if(error)throw error;
}

async function run(){
  const [{coins,market,overlay},gold,dollar,d30]=await Promise.all([loadLatest(),fred("GOLDPMGBD228NLBM"),fred("DTWEXBGS"),fred("DGS30")]);
  if(!coins.length)throw new Error("No GN snapshots available");
  const btc=coins.find(x=>x.coin==="BTC");
  const regime=debasementScore({gold,dollar,d30,btc,overlay});
  const liquidity=liquidityScore({coins,market});
  const decisions=coins.map(row=>decide(row,regime,liquidity)).sort((a,b)=>b.score-a.score);
  const recovery=await crossAssetRecovery(coins);

  await writeRecoveryLeader(recovery);
  for(const d of decisions.slice(0,3)){
    if(!(await shouldWrite(d)))continue;
    const msg=`${d.coin} ${d.action} | 투자비서 ${d.score.toFixed(1)} | Debasement ${regime.toFixed(1)} | Liquidity ${liquidity.toFixed(1)} | Catch-up ${d.catchup.toFixed(1)} | ${d.reason.join(" · ")||"조건 대기"}`;
    const {error}=await db.from("gn_alerts").insert({coin:d.coin,level:"투자비서",score:d.score,stage:d.action,message:msg,snapshot_id:d.snapshotId});
    if(error)throw error;
  }

  console.log(JSON.stringify({ok:true,regime,liquidity,recovery,macro:{gold,dollar,d30},top:decisions.slice(0,3)},null,2));
}

run().catch(error=>{console.error("GN investment assistant failed",error);process.exit(1);});
