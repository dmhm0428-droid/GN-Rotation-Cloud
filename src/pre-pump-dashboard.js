"use strict";

const TOP3_MIN_SCORE=58;
const TOP3_MAX_SCORE=82;
const TOP3_MAX_RETURN_5M=.035;
const TOP3_MAX_RETURN_15M=.06;
const TOP3_MIN_DAILY_IGNITION=45;
const TOP3_STATUSES=new Set(["SCOUT","ENTRY","CONFIRM_WAIT"]);

const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
const isLatePump=d=>{const x=d?.late_pump;return !!x&&(x.latePumpRisk===true||x.risk===true||x.blocked===true||x.no_chase===true);};
const marketScoreOf=r=>num(r?.details?.market_context?.marketScore);
const orderbookOf=r=>r?.details?.orderbook||null;
const signed=(v,d=1)=>{const n=num(v);return n==null?"?":`${n>=0?"+":""}${n.toFixed(d)}`;};

function formatDashboardStatus(x){
  const a=x.action||"관찰";
  const m=x.marketScore==null?"시장?":`시장${Number(x.marketScore).toFixed(0)}`;
  const md=x.marketDelta==null?"":`(${signed(x.marketDelta,0)})`;
  const p=x.pumpDelta==null?"":` · 펌프Δ${signed(x.pumpDelta,1)}`;
  const o=x.orderbookSignal&&x.orderbookSignal!=="UNKNOWN"?` · 호가 ${x.orderbookSignal}`:"";
  return `${a} · ${m}${md}${p}${o}`;
}

function isDisplayableTopCandidate(r){
  if(!r||Number(r.rank)>=100)return false;
  if(!TOP3_STATUSES.has(String(r.status||"").toUpperCase()))return false;
  const s=num(r.score),r5=num(r.return5m),r15=num(r.return15m);
  if(s==null||s<TOP3_MIN_SCORE||s>TOP3_MAX_SCORE)return false;
  if(r5==null||r5<=0||r5>TOP3_MAX_RETURN_5M)return false;
  if(r15==null||r15<=0||r15>TOP3_MAX_RETURN_15M)return false;
  const d=r.details?.daily_ignition;
  if(d?.available===true&&Number(d.score)<TOP3_MIN_DAILY_IGNITION)return false;
  if(r.details?.market_block||r.details?.market_context?.warOverride===true||isLatePump(r.details))return false;
  return true;
}

function classifyAction({row,marketScore}){
  const score=num(row?.score)??0;
  const status=String(row?.status||"").toUpperCase();
  const r15=num(row?.return15m)??0;
  const orderbook=orderbookOf(row);
  const orderbookSignal=String(orderbook?.signal||"UNKNOWN");
  const orderbookBlocked=orderbook?.entry_blocked===true||status==="CONFIRM_WAIT"||orderbookSignal==="SELL_PRESSURE"||orderbookSignal==="ASK_WALL";
  if(isLatePump(row?.details)||status==="NO_CHASE")return {action:"추격금지",tone:"bad",reason:"과열/후행펌프 · 신규진입 금지",orderbookSignal};
  if(orderbookBlocked)return {action:"진입대기",tone:"warn",reason:"호가 매도압력/매도벽 확인 필요",orderbookSignal};
  if(marketScore!=null&&marketScore>=55&&marketScore<=69&&score>=68&&score<=82&&r15<=.03)return {action:"진입",tone:"good",reason:"시장·펌프 강도 확인 + 과열 전",orderbookSignal};
  if(score>=68&&score<=82&&marketScore!=null&&marketScore>=55)return {action:"진입대기",tone:"blue",reason:"강도는 유효 · 진입 조건 재확인",orderbookSignal};
  return {action:"진입대기",tone:"muted",reason:"신규진입 조건 일부 미충족",orderbookSignal};
}

function formatCandidate(row,x={}){
  const context=row.details?.market_context||null;
  const daily=row.details?.daily_ignition||null;
  const orderbook=orderbookOf(row);
  const listing=row.details?.new_listing||null;
  return {
    rank:x.rank,
    market:row.market,
    score:row.score,
    scannerStatus:row.status,
    status:formatDashboardStatus({...x,orderbookSignal:x.orderbookSignal||orderbook?.signal}),
    action:x.action,
    actionTone:x.tone,
    actionReason:x.reason,
    holding:false,
    inLatest:true,
    return5m:row.return5m,
    return15m:row.return15m,
    volumeRatio15m:row.volume_ratio15m,
    krwPrice:row.krw_price??null,
    pumpDelta:null,
    marketScore:x.marketScore??marketScoreOf(row),
    marketDelta:x.marketDelta??null,
    gainFromSignalPct:null,
    ageMinutes:0,
    reason:row.details?.confirmation?.reason||row.details?.market_block||null,
    latePump:row.details?.late_pump||null,
    newListing:listing?{
      isNew:listing.is_new===true,
      ageDays:listing.age_days??null,
      overseasAvailable:listing.overseas_available===true,
      source:listing.source??null,
      overseasListingUsd:listing.overseas_listing_usd??null,
      overseasCurrentUsd:listing.overseas_current_usd??null,
      overseasReturnPct:num(listing.return_from_overseas_listing)==null?null:+(Number(listing.return_from_overseas_listing)*100).toFixed(1),
      upbitPremiumPct:num(listing.upbit_premium_vs_overseas)==null?null:+(Number(listing.upbit_premium_vs_overseas)*100).toFixed(1),
      scoreDelta:listing.score_delta??0,
      reasons:listing.reasons||[]
    }:null,
    orderbook:orderbook?{available:orderbook.available===true,signal:orderbook.signal||"UNKNOWN",entryBlocked:orderbook.entry_blocked===true}:null,
    dailyIgnition:daily?{score:daily.score,stage:daily.stage,available:daily.available,reasons:daily.reasons||[]}:null,
    marketContext:context?{marketScore:context.marketScore,gateScore:context.gateScore,regime:context.regime,breadth:context.breadth,policyScore:context.policyScore,aiBias:context.aiBias,warOverride:context.warOverride}:null,
    updated_at:row.ts
  };
}

async function readMarketTrend(db){
  try{
    const q=await db.from("gn_market_snapshots").select("ts,market_score").order("ts",{ascending:false}).limit(4);
    const r=q.error?[]:(q.data||[]),a=num(r[0]?.market_score),b=num(r.at(-1)?.market_score);
    return {score:a,delta:a!=null&&b!=null?a-b:null};
  }catch{return {score:null,delta:null};}
}

async function loadLatestPrePump(db){
  const latest=await db.from("gn_pre_pump_snapshots").select("run_id,ts").order("ts",{ascending:false}).limit(1).maybeSingle();
  if(latest.error)throw latest.error;
  if(!latest.data)return [];
  const rows=await db.from("gn_pre_pump_snapshots").select("rank,market,score,status,return5m,return15m,volume_ratio15m,krw_price,details,ts").eq("run_id",latest.data.run_id).order("rank",{ascending:true}).limit(20);
  if(rows.error)throw rows.error;
  const marketTrend=await readMarketTrend(db);
  const candidates=(rows.data||[]).filter(isDisplayableTopCandidate).sort((a,b)=>Number(b.score)-Number(a.score)||Number(a.rank)-Number(b.rank));
  const evaluated=candidates.map(row=>{
    const marketScore=marketTrend.score??marketScoreOf(row);
    const action=classifyAction({row,marketScore});
    return formatCandidate(row,{marketScore,marketDelta:marketTrend.delta,...action});
  });
  const allowed=new Set(["진입","진입대기"]);
  return evaluated.filter(x=>allowed.has(x.action)).sort((a,b)=>{
    const p={"진입":0,"진입대기":1};
    return (p[a.action]??9)-(p[b.action]??9)||Number(b.score)-Number(a.score);
  }).slice(0,3).map((x,i)=>({...x,rank:i+1}));
}

function createLatestPrePumpHandler({db,load=loadLatestPrePump}){
  return async function(req,res){
    try{return res.json(await load(db));}
    catch(error){return res.status(500).json({error:error?.message||"Failed to load scanner data"});}
  };
}

module.exports={classifyAction,createLatestPrePumpHandler,formatCandidate,isDisplayableTopCandidate,loadLatestPrePump};
