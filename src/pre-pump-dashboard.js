"use strict";

const TOP3_MIN_SCORE=58;
const TOP3_MAX_SCORE=82;
const TOP3_MAX_RETURN_5M=.035;
const TOP3_MAX_RETURN_15M=.06;
const TOP3_MIN_DAILY_IGNITION=45;
const TOP3_STATUSES=new Set(["SCOUT","ENTRY","CONFIRM_WAIT"]);
const UPBIT_BASE="https://api.upbit.com";

const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
const isLatePump=d=>{const x=d?.late_pump;return !!x&&(x.latePumpRisk===true||x.risk===true||x.blocked===true||x.no_chase===true);};
const marketScoreOf=r=>num(r?.details?.market_context?.marketScore);
const orderbookOf=r=>r?.details?.orderbook||null;
const signed=(v,d=1)=>{const n=num(v);return n==null?"?":`${n>=0?"+":""}${n.toFixed(d)}`;};
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
const mean=a=>{const v=(a||[]).map(Number).filter(Number.isFinite);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null;};

async function fetchJson(url,{fetchImpl=fetch,timeoutMs=6500}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetchImpl(url,{signal:controller.signal,headers:{Accept:"application/json","User-Agent":"GN-MTF-Validator-v1"}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return r.json();
  }finally{clearTimeout(timer);}
}

function candleClose(c){return num(c?.trade_price);}
function candleTurnover(c){return num(c?.candle_acc_trade_price)??0;}
function candleHigh(c){return num(c?.high_price)??candleClose(c);}
function candleLow(c){return num(c?.low_price)??candleClose(c);}
function candleOpen(c){return num(c?.opening_price)??candleClose(c);}

function aggregateCandles(rows,size){
  const src=(rows||[]).slice();
  const out=[];
  for(let i=0;i+size-1<src.length;i+=size){
    const g=src.slice(i,i+size); // newest -> oldest
    const newest=g[0],oldest=g.at(-1);
    out.push({
      trade_price:candleClose(newest),
      opening_price:candleOpen(oldest),
      high_price:Math.max(...g.map(candleHigh).filter(Number.isFinite)),
      low_price:Math.min(...g.map(candleLow).filter(Number.isFinite)),
      candle_acc_trade_price:g.reduce((s,c)=>s+candleTurnover(c),0)
    });
  }
  return out;
}

function frameTrend(rows,{fast=5,slow=20}={}){
  const closes=(rows||[]).map(candleClose).filter(Number.isFinite);
  if(closes.length<Math.max(fast+2,slow))return {available:false,score:50,label:"UNKNOWN",price:null,maFast:null,maSlow:null,slope:null};
  const price=closes[0],maFast=mean(closes.slice(0,fast)),maSlow=mean(closes.slice(0,slow));
  const prevFast=mean(closes.slice(2,fast+2));
  const slope=maFast&&prevFast?maFast/prevFast-1:0;
  let score=50;
  if(price>=maFast)score+=12;else score-=12;
  if(maFast>=maSlow)score+=16;else score-=16;
  if(slope>0)score+=12;else if(slope<0)score-=12;
  const recentLow=Math.min(...(rows||[]).slice(0,5).map(candleLow).filter(Number.isFinite));
  const priorLow=Math.min(...(rows||[]).slice(5,10).map(candleLow).filter(Number.isFinite));
  if(Number.isFinite(recentLow)&&Number.isFinite(priorLow)){if(recentLow>=priorLow)score+=10;else score-=10;}
  score=clamp(score);
  const label=score>=68?"UP":score<=38?"DOWN":"NEUTRAL";
  return {available:true,score:+score.toFixed(1),label,price,maFast,maSlow,slope:+(slope*100).toFixed(2)};
}

function turnoverExpansion(rows,window=3){
  const v=(rows||[]).map(candleTurnover);
  if(v.length<window*2)return null;
  const recent=mean(v.slice(0,window)),prior=mean(v.slice(window,window*2));
  return recent!=null&&prior>0?recent/prior:null;
}

function volumeContext({m3,m15,m45}){
  const r3=turnoverExpansion(m3,4),r15=turnoverExpansion(m15,3),r45=turnoverExpansion(m45,3);
  let score=50;
  const add=(r,w)=>{if(!Number.isFinite(r))return;if(r>=1.15&&r<=3)score+=w;else if(r>=.8&&r<1.15)score+=w*.25;else if(r>4)score-=w;else if(r<.55)score-=w*.6;};
  add(r3,12);add(r15,16);add(r45,18);
  if(Number.isFinite(r45)&&Number.isFinite(r15)&&r45>=1&&r15>=1)score+=8;
  if(Number.isFinite(r3)&&r3>=1.1&&Number.isFinite(r15)&&r15>=1)score+=6;
  return {score:+clamp(score).toFixed(1),ratio3m:r3==null?null:+r3.toFixed(2),ratio15m:r15==null?null:+r15.toFixed(2),ratio45m:r45==null?null:+r45.toFixed(2)};
}

function falseBreakContext(rows15,rows60,orderbook){
  const inspect=(rows,count)=>{
    let risk=0;
    for(const c of (rows||[]).slice(0,count)){
      const o=candleOpen(c),h=candleHigh(c),l=candleLow(c),cl=candleClose(c),t=candleTurnover(c);
      if(![o,h,l,cl].every(Number.isFinite)||h<=l)continue;
      const upper=(h-Math.max(o,cl))/(h-l),closeLoc=(cl-l)/(h-l);
      if(upper>=.45&&closeLoc<=.55)risk++;
      if(t>0&&upper>=.6&&closeLoc<=.4)risk++;
    }
    return risk;
  };
  const wickRisk=inspect(rows15,4)+inspect(rows60,3);
  const signal=String(orderbook?.signal||"UNKNOWN");
  const bookRisk=orderbook?.entry_blocked===true||signal==="SELL_PRESSURE"||signal==="ASK_WALL";
  return {risk:wickRisk+(bookRisk?2:0),blocked:wickRisk>=3||bookRisk,wickRisk,orderbookRisk:bookRisk};
}

function supportResistance(rows15,rows60,days){
  const current=candleClose(rows15?.[0])??candleClose(rows60?.[0])??candleClose(days?.[0]);
  if(!(current>0))return {support:null,resistance:null,supportDistance:null,resistanceDistance:null};
  const lows=[...(rows15||[]).slice(0,24),...(rows60||[]).slice(0,24),...(days||[]).slice(0,20)].map(candleLow).filter(Number.isFinite).filter(x=>x<=current);
  const highs=[...(rows15||[]).slice(0,24),...(rows60||[]).slice(0,24),...(days||[]).slice(0,20)].map(candleHigh).filter(Number.isFinite).filter(x=>x>=current);
  const support=lows.length?Math.max(...lows):null,resistance=highs.length?Math.min(...highs):null;
  return {support,resistance,supportDistance:support?+(current/support-1).toFixed(4):null,resistanceDistance:resistance?+(resistance/current-1).toFixed(4):null};
}

async function loadMultiTimeframe(market,{fetchImpl=fetch}={}){
  const q=encodeURIComponent(market);
  try{
    const [m3,m15,m60,m240,days,weeks,months]=await Promise.all([
      fetchJson(`${UPBIT_BASE}/v1/candles/minutes/3?market=${q}&count=60`,{fetchImpl}),
      fetchJson(`${UPBIT_BASE}/v1/candles/minutes/15?market=${q}&count=80`,{fetchImpl}),
      fetchJson(`${UPBIT_BASE}/v1/candles/minutes/60?market=${q}&count=80`,{fetchImpl}),
      fetchJson(`${UPBIT_BASE}/v1/candles/minutes/240?market=${q}&count=80`,{fetchImpl}),
      fetchJson(`${UPBIT_BASE}/v1/candles/days?market=${q}&count=90`,{fetchImpl}),
      fetchJson(`${UPBIT_BASE}/v1/candles/weeks?market=${q}&count=40`,{fetchImpl}),
      fetchJson(`${UPBIT_BASE}/v1/candles/months?market=${q}&count=30`,{fetchImpl})
    ]);
    const m45=aggregateCandles(m15,3),m120=aggregateCandles(m60,2),d3=aggregateCandles(days,3);
    const frames={
      month:frameTrend(months,{fast:3,slow:8}),week:frameTrend(weeks,{fast:4,slow:12}),day3:frameTrend(d3,{fast:5,slow:15}),day:frameTrend(days,{fast:5,slow:20}),
      h4:frameTrend(m240,{fast:5,slow:20}),h2:frameTrend(m120,{fast:5,slow:20}),h1:frameTrend(m60,{fast:5,slow:20}),m45:frameTrend(m45,{fast:5,slow:20}),m15:frameTrend(m15,{fast:5,slow:20}),m3:frameTrend(m3,{fast:5,slow:20})
    };
    const weights={month:.08,week:.12,day3:.12,day:.14,h4:.14,h2:.11,h1:.11,m45:.07,m15:.07,m3:.04};
    let weighted=0,w=0,upCount=0,downCount=0;
    for(const [k,weight] of Object.entries(weights)){const f=frames[k];if(!f.available)continue;weighted+=f.score*weight;w+=weight;if(f.label==="UP")upCount++;if(f.label==="DOWN")downCount++;}
    const continuity=w?weighted/w:50;
    const higherFrames=[frames.month,frames.week,frames.day3,frames.day,frames.h4].filter(x=>x.available);
    const higherConflict=higherFrames.filter(x=>x.label==="DOWN").length>=2;
    const lowerContinuation=[frames.h2,frames.h1,frames.m45,frames.m15].filter(x=>x.available&&x.label==="UP").length>=3;
    const volume=volumeContext({m3,m15,m45});
    const sr=supportResistance(m15,m60,days);
    return {available:true,continuityScore:+continuity.toFixed(1),higherConflict,lowerContinuation,upCount,downCount,frames,volume,supportResistance:sr};
  }catch(error){return {available:false,continuityScore:null,higherConflict:false,lowerContinuation:false,error:String(error?.message||error)};}
}

function formatDashboardStatus(x){
  const a=x.action||"관찰";
  const m=x.marketScore==null?"시장?":`시장${Number(x.marketScore).toFixed(0)}`;
  const md=x.marketDelta==null?"":`(${signed(x.marketDelta,0)})`;
  const p=x.pumpDelta==null?"":` · 펌프Δ${signed(x.pumpDelta,1)}`;
  const o=x.orderbookSignal&&x.orderbookSignal!=="UNKNOWN"?` · 호가 ${x.orderbookSignal}`:"";
  const c=x.continuityScore==null?"":` · 연속성${Number(x.continuityScore).toFixed(0)}`;
  return `${a} · ${m}${md}${p}${o}${c}`;
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

function classifyAction({row,marketScore,timeframe}){
  const score=num(row?.score)??0;
  const status=String(row?.status||"").toUpperCase();
  const r15=num(row?.return15m)??0;
  const orderbook=orderbookOf(row);
  const orderbookSignal=String(orderbook?.signal||"UNKNOWN");
  const fake=falseBreakContext(timeframe?.raw15||[],timeframe?.raw60||[],orderbook);
  const tfAvailable=timeframe?.available===true;
  const continuity=num(timeframe?.continuityScore);
  const volumeScore=num(timeframe?.volume?.score);
  const orderbookBlocked=orderbook?.entry_blocked===true||orderbookSignal==="SELL_PRESSURE"||orderbookSignal==="ASK_WALL";
  if(isLatePump(row?.details)||status==="NO_CHASE")return {action:"추격금지",tone:"bad",reason:"과열/후행펌프 · 신규진입 금지",orderbookSignal};
  if(tfAvailable&&timeframe.higherConflict)return {action:"검증중",tone:"warn",reason:"월·주·일/4H 상위 추세 충돌",orderbookSignal};
  if(fake.blocked||orderbookBlocked)return {action:"검증중",tone:"warn",reason:"윗꼬리/매도벽이 실제 매집인지 재검증",orderbookSignal};
  if(!tfAvailable)return {action:"검증중",tone:"muted",reason:"멀티타임프레임 실시간 데이터 재수집",orderbookSignal};
  if(continuity<58)return {action:"검증중",tone:"muted",reason:"상·하위 시간축 연결 부족",orderbookSignal};
  if(volumeScore<48)return {action:"검증중",tone:"blue",reason:"3m·15m·45m 거래대금 지속성 부족",orderbookSignal};
  if(marketScore!=null&&marketScore>=55&&score>=68&&score<=82&&r15<=.03&&continuity>=67&&volumeScore>=55&&timeframe.lowerContinuation)return {action:"진입",tone:"good",reason:"상위추세+1/2/4H+3/15/45m 거래량 연속성 확인",orderbookSignal};
  if(score>=62&&marketScore!=null&&marketScore>=50&&continuity>=62)return {action:"선발대",tone:"blue",reason:"맥락 유효 · 저항/거래량 재확인 후 소액",orderbookSignal};
  return {action:"검증중",tone:"muted",reason:"진입 전 연결구조 추가 확인",orderbookSignal};
}

function formatCandidate(row,x={}){
  const context=row.details?.market_context||null;
  const daily=row.details?.daily_ignition||null;
  const orderbook=orderbookOf(row);
  const listing=row.details?.new_listing||null;
  const tf=x.timeframe||null;
  return {
    rank:x.rank,
    market:row.market,
    score:row.score,
    scannerStatus:row.status,
    status:formatDashboardStatus({...x,continuityScore:tf?.continuityScore,orderbookSignal:x.orderbookSignal||orderbook?.signal}),
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
    newListing:listing?{isNew:listing.is_new===true,ageDays:listing.age_days??null,overseasAvailable:listing.overseas_available===true,source:listing.source??null,overseasListingUsd:listing.overseas_listing_usd??null,overseasCurrentUsd:listing.overseas_current_usd??null,overseasReturnPct:num(listing.return_from_overseas_listing)==null?null:+(Number(listing.return_from_overseas_listing)*100).toFixed(1),upbitPremiumPct:num(listing.upbit_premium_vs_overseas)==null?null:+(Number(listing.upbit_premium_vs_overseas)*100).toFixed(1),scoreDelta:listing.score_delta??0,reasons:listing.reasons||[]}:null,
    orderbook:orderbook?{available:orderbook.available===true,signal:orderbook.signal||"UNKNOWN",entryBlocked:orderbook.entry_blocked===true}:null,
    dailyIgnition:daily?{score:daily.score,stage:daily.stage,available:daily.available,reasons:daily.reasons||[]}:null,
    timeframeContext:tf?{available:tf.available,continuityScore:tf.continuityScore,higherConflict:tf.higherConflict,lowerContinuation:tf.lowerContinuation,frames:tf.frames,volume:tf.volume,supportResistance:tf.supportResistance,error:tf.error||null}:null,
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

async function loadLatestPrePump(db,{fetchImpl=fetch}={}){
  const latest=await db.from("gn_pre_pump_snapshots").select("run_id,ts").order("ts",{ascending:false}).limit(1).maybeSingle();
  if(latest.error)throw latest.error;
  if(!latest.data)return [];
  const rows=await db.from("gn_pre_pump_snapshots").select("rank,market,score,status,return5m,return15m,volume_ratio15m,krw_price,details,ts").eq("run_id",latest.data.run_id).order("rank",{ascending:true}).limit(20);
  if(rows.error)throw rows.error;
  const marketTrend=await readMarketTrend(db);
  const candidates=(rows.data||[]).filter(isDisplayableTopCandidate).sort((a,b)=>Number(b.score)-Number(a.score)||Number(a.rank)-Number(b.rank)).slice(0,8);
  const tfResults=await Promise.all(candidates.map(async row=>{
    const tf=await loadMultiTimeframe(row.market,{fetchImpl});
    // retain raw short frames only for internal false-break validation, never expose them
    if(tf.available){
      try{
        const q=encodeURIComponent(row.market);
        const [raw15,raw60]=await Promise.all([
          fetchJson(`${UPBIT_BASE}/v1/candles/minutes/15?market=${q}&count=12`,{fetchImpl}),
          fetchJson(`${UPBIT_BASE}/v1/candles/minutes/60?market=${q}&count=8`,{fetchImpl})
        ]);
        tf.raw15=raw15;tf.raw60=raw60;
      }catch{}
    }
    return tf;
  }));
  const evaluated=candidates.map((row,i)=>{
    const marketScore=marketTrend.score??marketScoreOf(row);
    const timeframe=tfResults[i];
    const action=classifyAction({row,marketScore,timeframe});
    return formatCandidate(row,{marketScore,marketDelta:marketTrend.delta,timeframe,...action});
  });
  const priority={"진입":0,"선발대":1,"검증중":2,"추격금지":3};
  return evaluated.sort((a,b)=>(priority[a.action]??9)-(priority[b.action]??9)||(Number(b.timeframeContext?.continuityScore)||0)-(Number(a.timeframeContext?.continuityScore)||0)||Number(b.score)-Number(a.score)).slice(0,3).map((x,i)=>({...x,rank:i+1}));
}

function createLatestPrePumpHandler({db,load=loadLatestPrePump}){
  return async function(req,res){
    try{return res.json(await load(db));}
    catch(error){return res.status(500).json({error:error?.message||"Failed to load scanner data"});}
  };
}

module.exports={classifyAction,createLatestPrePumpHandler,formatCandidate,isDisplayableTopCandidate,loadLatestPrePump,loadMultiTimeframe,frameTrend,volumeContext,aggregateCandles};