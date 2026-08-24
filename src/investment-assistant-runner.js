"use strict";

const {createClient}=require("@supabase/supabase-js");

const URL=process.env.SUPABASE_URL;
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!URL||!KEY)throw new Error("Supabase env vars missing");
const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});

const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,x));
const num=x=>Number.isFinite(Number(x))?Number(x):null;

async function fetchText(url){
  const ac=new AbortController();
  const timer=setTimeout(()=>ac.abort(),10000);
  try{
    const r=await fetch(url,{signal:ac.signal,headers:{"User-Agent":"GN-Investment-Assistant-v1"}});
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
  }catch(error){
    return {value:null,change:null,date:null,error:String(error.message||error)};
  }
}

async function loadLatest(){
  const [{data:snapshots,error:snapErr},{data:market,error:marketErr},{data:overlay,error:overlayErr}]=await Promise.all([
    db.from("gn_snapshots").select("*").order("ts",{ascending:false}).limit(24),
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
  const goldUp=num(gold?.change);
  const dollarChg=num(dollar?.change);
  const d30Chg=num(d30?.change);
  const btc24=num(btc?.rs24);
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
  const btc=coins.find(x=>x.coin==="BTC");
  const eth=coins.find(x=>x.coin==="ETH");
  let s=50;
  if(num(btc?.rs24)!=null)s+=btc.rs24>0?10:-10;
  if(num(eth?.rs24)!=null)s+=eth.rs24>0?12:eth.rs24<0?-8:0;
  if(num(btc?.dom1h_pp)!=null)s+=btc.dom1h_pp<0?8:btc.dom1h_pp>0?-6:0;
  const breadth=num(market?.spot_breadth100);
  if(breadth!=null)s+=breadth>=0.60?12:breadth<=0.40?-12:0;
  const btcTaker=num(market?.btc_taker_ratio);
  const ethTaker=num(market?.eth_taker_ratio);
  if(btcTaker!=null)s+=btcTaker>0?5:btcTaker<0?-5:0;
  if(ethTaker!=null)s+=ethTaker>0?5:ethTaker<0?-5:0;
  return +clamp(s).toFixed(1);
}

function catchupScore(row){
  let s=50;
  const rs4=num(row.rs4),rs24=num(row.rs24),cvd=num(row.cvd15),funding=Math.abs(num(row.funding)||0);
  if(row.coin==="BTC"){
    if(rs4!=null)s+=rs4>0?8:-8;
    if(rs24!=null)s+=rs24>0?8:-8;
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
  const quality=num(row.data_quality)??0;
  const base=clamp((num(row.score)??0)*10);
  const catchup=catchupScore(row);
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

async function shouldWrite(d){
  const {data}=await db.from("gn_alerts")
    .select("ts,stage,score")
    .eq("coin",d.coin).eq("level","투자비서")
    .order("ts",{ascending:false}).limit(1).maybeSingle();
  if(!data)return true;
  const age=Date.now()-new Date(data.ts).getTime();
  const scoreMoved=Math.abs((num(data.score)??0)-d.score)>=4;
  return data.stage!==d.action||scoreMoved||age>2*60*60*1000;
}

async function run(){
  const [{coins,market,overlay},gold,dollar,d30]=await Promise.all([
    loadLatest(),fred("GOLDPMGBD228NLBM"),fred("DTWEXBGS"),fred("DGS30")
  ]);
  if(!coins.length)throw new Error("No GN snapshots available");
  const btc=coins.find(x=>x.coin==="BTC");
  const regime=debasementScore({gold,dollar,d30,btc,overlay});
  const liquidity=liquidityScore({coins,market});
  const decisions=coins.map(row=>decide(row,regime,liquidity)).sort((a,b)=>b.score-a.score);

  for(const d of decisions.slice(0,3)){
    if(!(await shouldWrite(d)))continue;
    const msg=`${d.coin} ${d.action} | 투자비서 ${d.score.toFixed(1)} | Debasement ${regime.toFixed(1)} | Liquidity ${liquidity.toFixed(1)} | Catch-up ${d.catchup.toFixed(1)} | ${d.reason.join(" · ")||"조건 대기"}`;
    const {error}=await db.from("gn_alerts").insert({
      coin:d.coin,level:"투자비서",score:d.score,stage:d.action,message:msg,snapshot_id:d.snapshotId
    });
    if(error)throw error;
  }

  console.log(JSON.stringify({ok:true,regime,liquidity,macro:{gold,dollar,d30},top:decisions.slice(0,3)},null,2));
}

run().catch(error=>{console.error("GN investment assistant failed",error);process.exit(1);});
