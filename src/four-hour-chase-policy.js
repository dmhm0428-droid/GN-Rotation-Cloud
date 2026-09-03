"use strict";

function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function mean(values){const a=(values||[]).map(Number).filter(Number.isFinite);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}
function std(values,avg){const a=(values||[]).map(Number).filter(Number.isFinite);if(!a.length||!Number.isFinite(avg))return null;return Math.sqrt(a.reduce((s,x)=>s+(x-avg)**2,0)/a.length);}

function analyzeSeries(rows,{kind="upbit"}={}){
  const normalized=(Array.isArray(rows)?rows:[]).map(row=>{
    if(kind==="binance")return {open:num(row?.[1]),high:num(row?.[2]),low:num(row?.[3]),close:num(row?.[4])};
    return {open:num(row?.opening_price),high:num(row?.high_price),low:num(row?.low_price),close:num(row?.trade_price)};
  }).filter(x=>x.open>0&&x.high>0&&x.low>0&&x.close>0);
  if(normalized.length<21)return {available:false,source:kind,reasons:["4H 봉 데이터 부족"]};

  // Upbit returns newest first, Binance oldest first. Convert to chronological.
  const chrono=kind==="upbit"?normalized.slice().reverse():normalized.slice();
  const current=chrono.at(-1),previous=chrono.slice(-21,-1),window20=chrono.slice(-20);
  if(!current||previous.length<20||window20.length<20)return {available:false,source:kind,reasons:["4H 계산 구간 부족"]};

  const closes=window20.map(x=>x.close),ma20=mean(closes),sd20=std(closes,ma20);
  const upper=ma20!=null&&sd20!=null?ma20+2*sd20:null;
  const lower=ma20!=null&&sd20!=null?ma20-2*sd20:null;
  const bandWidth=upper!=null&&lower!=null?upper-lower:null;
  const bbPosition=bandWidth&&bandWidth>0?(current.close-lower)/bandWidth:null;
  const priorSwingHigh=Math.max(...previous.map(x=>x.high));
  const swingHighDistancePct=priorSwingHigh>0?(current.close/priorSwingHigh-1)*100:null;
  const ma20StretchPct=ma20&&ma20>0?(current.close/ma20-1)*100:null;
  const candleReturnPct=current.open>0?(current.close/current.open-1)*100:null;

  const bollingerTop=bbPosition!=null&&bbPosition>=0.85;
  const nearSwingHigh=swingHighDistancePct!=null&&swingHighDistancePct>=-1&&swingHighDistancePct<=2;
  const ma20Stretched=ma20StretchPct!=null&&ma20StretchPct>=2.5;
  const candleExtended=candleReturnPct!=null&&candleReturnPct>=3;
  const conditions=[bollingerTop,nearSwingHigh,ma20Stretched,candleExtended];
  const hitCount=conditions.filter(Boolean).length;

  // Narrow Bollinger bands can put a quiet +0.x% candle above the upper band even when the
  // candidate still has ample swing-high headroom. Bollinger position alone must not create an
  // "extreme" chase block; require real extension/near-high confirmation as well.
  const bbExtreme=bbPosition!=null&&bbPosition>=0.95&&(nearSwingHigh||ma20Stretched||candleExtended);
  const extreme=bbExtreme||(ma20StretchPct!=null&&ma20StretchPct>=5)||(candleReturnPct!=null&&candleReturnPct>=5);
  const blockTop3=extreme||hitCount>=2;
  const reasons=[];
  if(bollingerTop)reasons.push(`4H 볼린저 상단 ${(bbPosition*100).toFixed(0)}%`);
  if(nearSwingHigh)reasons.push(`4H 스윙고점 거리 ${swingHighDistancePct.toFixed(2)}%`);
  if(ma20Stretched)reasons.push(`4H MA20 이격 +${ma20StretchPct.toFixed(2)}%`);
  if(candleExtended)reasons.push(`현재 4H 봉 +${candleReturnPct.toFixed(2)}%`);

  return {
    available:true,source:kind,blockTop3,extreme,hitCount,reasons,
    bbPosition:bbPosition==null?null:+bbPosition.toFixed(4),
    swingHighDistancePct:swingHighDistancePct==null?null:+swingHighDistancePct.toFixed(3),
    ma20StretchPct:ma20StretchPct==null?null:+ma20StretchPct.toFixed(3),
    candleReturnPct:candleReturnPct==null?null:+candleReturnPct.toFixed(3),
    ma20:ma20==null?null:+ma20.toFixed(10),
    current:+current.close.toFixed(10),
    priorSwingHigh:+priorSwingHigh.toFixed(10)
  };
}

function combineFourHourChecks(checks){
  const available=(Array.isArray(checks)?checks:[]).filter(x=>x?.available===true);
  if(!available.length)return {available:false,blockTop3:false,entryBlocked:true,status:"UNVERIFIED",reasons:["4H 멀티거래소 데이터 미확인"],sources:checks||[]};
  const blocked=available.filter(x=>x.blockTop3===true);
  const extreme=available.some(x=>x.extreme===true);
  // If two venues are available, require cross-venue confirmation unless one venue is already extreme.
  const blockTop3=extreme||(available.length>=2?blocked.length>=2:blocked.length>=1);
  const watch=!blockTop3&&blocked.length>0;
  const reasons=[...new Set(available.flatMap(x=>x.reasons||[]))];
  return {
    available:true,
    blockTop3,
    entryBlocked:blockTop3,
    status:blockTop3?"NO_CHASE":watch?"WATCH":"OK",
    venueCount:available.length,
    blockedVenueCount:blocked.length,
    reasons:reasons.slice(0,6),
    sources:available
  };
}

module.exports={analyzeSeries,combineFourHourChecks};
