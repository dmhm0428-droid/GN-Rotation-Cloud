"use strict";

const {eventLeadSignal}=require("./event-lead-policy");

const REPOS={
  SOL:["anza-xyz/agave"],ETH:["ethereum/go-ethereum","ethereum/consensus-specs"],
  AVAX:["ava-labs/avalanchego"],ADA:["IntersectMBO/cardano-node"],POL:["0xPolygon/bor"],
  XLM:["stellar/stellar-core"],VET:["vechain/thor"],SUI:["MystenLabs/sui"],APT:["aptos-labs/aptos-core"],
  ARB:["OffchainLabs/nitro"],OP:["ethereum-optimism/optimism"],NEAR:["near/nearcore"],INJ:["InjectiveLabs/injective-core"]
};
const DAY=86400000;
const finite=v=>Number.isFinite(Number(v))?Number(v):null;
const median=a=>{const x=a.filter(Number.isFinite).sort((p,q)=>p-q);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;};

async function json(url,{fetchImpl=fetch,headers={}}={}){
  const r=await fetchImpl(url,{headers:{accept:"application/vnd.github+json","user-agent":"GN-Rotation-Cloud",...headers}});
  if(!r.ok)throw new Error(`${r.status} ${url}`);return r.json();
}
function recent(ts,days){const t=new Date(ts||0).getTime();return Number.isFinite(t)&&Date.now()-t<=days*DAY&&Date.now()>=t-5*60*1000;}
function textOf(x){return JSON.stringify(x||{}).toLowerCase();}

async function githubSignals(symbol,{fetchImpl=fetch,token=process.env.GITHUB_TOKEN}={}){
  const repos=REPOS[symbol]||[];const out=[];const headers=token?{authorization:`Bearer ${token}`}:{ };
  for(const repo of repos){
    try{
      const [releases,commits]=await Promise.all([
        json(`https://api.github.com/repos/${repo}/releases?per_page=5`,{fetchImpl,headers}),
        json(`https://api.github.com/repos/${repo}/commits?per_page=40`,{fetchImpl,headers})
      ]);
      const rel=Array.isArray(releases)?releases:[],com=Array.isArray(commits)?commits:[];
      const newest=rel.find(x=>recent(x.published_at||x.created_at,30))||null;
      const corpus=textOf([newest,com.slice(0,20).map(x=>x?.commit?.message)]);
      const commit7=com.filter(x=>recent(x?.commit?.committer?.date||x?.commit?.author?.date,7)).length;
      const commitPrev=com.filter(x=>{const t=new Date(x?.commit?.committer?.date||x?.commit?.author?.date||0).getTime();const age=Date.now()-t;return age>7*DAY&&age<=14*DAY;}).length;
      const momentum=commitPrev>0?commit7/commitPrev:(commit7>0?2:null);
      out.push({repo,releaseCandidate:Boolean(newest&&(recent(newest.published_at||newest.created_at,14)||/\brc\b|release candidate|beta/.test(corpus))),testnetActive:/(testnet|devnet|sepolia|holesky|fuji)/.test(corpus)&&Boolean(newest||commit7>0),commit7,commitPrev,commitMomentum:momentum,latestRelease:newest?{tag:newest.tag_name,name:newest.name,publishedAt:newest.published_at,url:newest.html_url}:null});
    }catch(error){out.push({repo,error:String(error?.message||error)});}
  }
  return out;
}

async function upbitPriceSignals(symbol,{fetchImpl=fetch}={}){
  const market=`KRW-${symbol}`;
  try{
    const [daily,mins]=await Promise.all([
      json(`https://api.upbit.com/v1/candles/days?market=${market}&count=30`,{fetchImpl,headers:{accept:"application/json"}}),
      json(`https://api.upbit.com/v1/candles/minutes/1?market=${market}&count=121`,{fetchImpl,headers:{accept:"application/json"}})
    ]);
    const d=Array.isArray(daily)?daily:[],m=Array.isArray(mins)?mins:[];
    if(!d.length||m.length<61)return {market,available:false};
    const now=finite(d[0]?.trade_price),p3=finite(d[3]?.trade_price),p7=finite(d[7]?.trade_price);
    const r60=m.length>60&&finite(m[60]?.trade_price)>0?finite(m[0]?.trade_price)/finite(m[60]?.trade_price)-1:null;
    const low2h=Math.min(...m.slice(0,121).map(x=>finite(x?.low_price)).filter(Number.isFinite));
    const ext2h=Number.isFinite(low2h)&&low2h>0?finite(m[0]?.trade_price)/low2h-1:null;
    const vols=d.slice(1,21).map(x=>finite(x?.candle_acc_trade_price)).filter(Number.isFinite);const med=median(vols);
    const vNow=finite(d[0]?.candle_acc_trade_price);const vr=med&&med>0&&vNow!=null?vNow/med:null;
    return {market,available:true,return3d:now&&p3?now/p3-1:null,return7d:now&&p7?now/p7-1:null,return60m:r60,extensionFromLow2h:ext2h,volume20dRatio:vr,krwPrice:finite(m[0]?.trade_price)};
  }catch(error){return {market,available:false,error:String(error?.message||error)};}
}

function activeExternal(signals){
  const now=Date.now();const active=(signals||[]).filter(s=>!s.expires_at||new Date(s.expires_at).getTime()>=now);
  const has=t=>active.some(s=>String(s.signal_type||"")===t&&finite(s.confidence??1)>=.5);
  return {validatorAdoption:has("validator_adoption")||has("node_adoption"),infraSupport:has("exchange_support")||has("wallet_support")||has("infrastructure_support"),treasuryWhale:has("treasury_action")||has("foundation_wallet_action")||has("whale_action"),external:active};
}

async function buildEventLead(symbol,calendarRow,signals,{fetchImpl=fetch}={}){
  const [git,price]=await Promise.all([githubSignals(symbol,{fetchImpl}),upbitPriceSignals(symbol,{fetchImpl})]);
  const ext=activeExternal(signals);const value=calendarRow?.value||{};const eventDate=value.event_date||calendarRow?.expires_at||null;
  const days=eventDate?(new Date(eventDate).getTime()-Date.now())/DAY:null;
  const releaseCandidate=git.some(x=>x.releaseCandidate===true);const testnetActive=git.some(x=>x.testnetActive===true);
  const eventLead={daysToEvent:days,officialDateConcrete:Boolean(eventDate),releaseCandidate,testnetActive,validatorAdoption:ext.validatorAdoption,infraSupport:ext.infraSupport,treasuryWhale:ext.treasuryWhale,return3d:price.return3d,return7d:price.return7d,volume20dRatio:price.volume20dRatio};
  const signal=eventLeadSignal({...price,eventLead});
  return {symbol,market:price.market||`KRW-${symbol}`,eventName:value.event_name||null,eventDate,eventLead,signal,price,github:git,external:ext.external};
}

module.exports={REPOS,githubSignals,upbitPriceSignals,buildEventLead};
