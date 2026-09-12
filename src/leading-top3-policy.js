"use strict";

function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function obj(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}
function uniq(xs){return [...new Set(xs.filter(Boolean))];}

function eventRisk(row){
  const d=obj(row?.details), ev=obj(row?.eventValidation||d.event_validation||d.event);
  const text=JSON.stringify(ev).toLowerCase();
  const bad=["hack","exploit","security incident","chain halt","mainnet halt","delist","delisting","unlock shock","breach","attack","해킹","공격","보안","중단","상폐"];
  return bad.some(k=>text.includes(k));
}

function hardDiscardReasons(row){
  const ev=obj(row?.empiricalValidation);
  const reasons=[];
  const ma20=num(row?.ma20Slope),obv=num(row?.obv1h),accel=num(row?.volumeAccel5m);
  const rise=num(row?.riseSinceFirstPct),age=num(row?.candidateAgeMin),repeat=Math.max(0,Number(row?.repeatCount)||0);
  const pxSlope=num(row?.priceSlope1h??row?.details?.price_slope_1h);
  const volSlope=num(row?.volumeSlope1h??row?.details?.volume_slope_1h);
  const globalSync=num(row?.globalExchangeSync??row?.details?.global_exchange_sync);
  const globalCount=num(row?.globalSpotExchangeCount??row?.details?.global_spot_exchange_count);
  const vwap=num(row?.vwapHold??row?.details?.vwap_hold);
  const r60=num(row?.return60m),extension2h=num(row?.extensionFromLow2h);
  if(ev.lagging===true)reasons.push("후행 판정");
  if(String(row?.precursorStage||row?.details?.precursor?.confidence_stage||"").toUpperCase()==="REJECT_DECAY")reasons.push("전조 약화");
  if(eventRisk(row))reasons.push("이벤트/보안 리스크");
  if(rise!=null&&rise<=-8)reasons.push("최초탐지 대비 -8% 이하");
  if(ma20!=null&&ma20<=-0.10&&obv!=null&&obv<0)reasons.push("가격기울기·OBV 동시 악화");
  if(pxSlope!=null&&pxSlope<0&&volSlope!=null&&volSlope<0&&repeat>=2)reasons.push("반복탐지 후 가격·거래량 기울기 동시 음전");
  if(globalCount!=null&&globalCount<2)reasons.push("해외 현물 동시성 2개 미만");
  if(globalSync!=null&&globalSync<0.45)reasons.push("해외 동시 확산 붕괴");
  if(vwap!=null&&vwap<0.35&&obv!=null&&obv<0)reasons.push("VWAP·OBV 동시 훼손");
  if(accel!=null&&accel>=12&&rise!=null&&rise>15)reasons.push("후반 거래량 과열/분배 위험");
  if(age!=null&&age>30&&repeat<2)reasons.push("30분 이상 재확인 없음");
  if(row?.preExpansionEligible===false)reasons.push("이미 1시간/2시간 확장");
  if(r60!=null&&r60>=.04)reasons.push("최근 60분 +4% 이상");
  if(extension2h!=null&&extension2h>=.05)reasons.push("2시간 저점 대비 +5% 이상");
  return uniq(reasons);
}

function passesTop3Gate(row){
  const repeat=Math.max(0,Number(row?.repeatCount)||0);
  const count=num(row?.globalSpotExchangeCount);
  const sync=num(row?.globalExchangeSync);
  const lead=row?.empiricalValidation?.lead_core===true||row?.recommendationEligible===true;
  return row?.preExpansionEligible===true&&lead&&repeat>=2&&count!=null&&count>=2&&sync!=null&&sync>=1&&num(row?.validationConfidence)>=80;
}

function lagReasons(row){
  const reasons=[];
  const ma=num(row?.maAlignment),ma20=num(row?.ma20Slope),obv=num(row?.obv1h),accel=num(row?.volumeAccel5m),age=num(row?.candidateAgeMin);
  if(ma!=null&&ma<40)reasons.push("MA정렬 40% 미만");
  if(ma20!=null&&ma20<=0)reasons.push("MA20 기울기 0 이하");
  if(obv!=null&&obv<=0)reasons.push("OBV1H 0 이하");
  if(accel!=null&&accel>=10)reasons.push("5분 거래량가속 10배 이상 과열");
  if(age!=null&&age>20)reasons.push("20분 이상 재등장 없음");
  return uniq(reasons.concat(hardDiscardReasons(row)));
}

function missingLeadConditions(row){
  const missing=[];
  const ma=num(row?.maAlignment),ma20=num(row?.ma20Slope),obv=num(row?.obv1h),accel=num(row?.volumeAccel5m);
  const repeat=Math.max(0,Number(row?.repeatCount)||0);
  const globalCount=num(row?.globalSpotExchangeCount??row?.details?.global_spot_exchange_count);
  const globalSync=num(row?.globalExchangeSync??row?.details?.global_exchange_sync);
  if(ma==null)missing.push("MA정렬 데이터"); else if(ma<60)missing.push(`MA정렬 ${ma.toFixed(0)}% < 60%`);
  if(ma20==null)missing.push("MA20 기울기"); else if(ma20<0.10)missing.push(`MA20 ${ma20.toFixed(2)} < 0.10`);
  if(obv==null)missing.push("OBV1H"); else if(obv<0.10)missing.push(`OBV1H ${obv.toFixed(2)} < 0.10`);
  if(accel==null)missing.push("5분 거래량가속"); else if(accel>=10)missing.push(`5분가속 ${accel.toFixed(1)}배 ≥ 10배`);
  if(repeat<2)missing.push(`반복 ${repeat}회 < 2회`);
  if(globalCount!=null&&globalCount<2)missing.push(`해외 현물 ${globalCount}개 < 2개`);
  if(globalSync!=null&&globalSync<0.55)missing.push(`해외 동시성 ${(globalSync*100).toFixed(0)}% < 55%`);
  return missing;
}

function confidenceScore(row){
  let s=50;
  const ma=num(row?.maAlignment),ma20=num(row?.ma20Slope),obv=num(row?.obv1h),accel=num(row?.volumeAccel5m);
  const repeat=Math.max(0,Number(row?.repeatCount)||0), mech=num(row?.mechanicalScore),rise=num(row?.riseSinceFirstPct);
  const globalCount=num(row?.globalSpotExchangeCount??row?.details?.global_spot_exchange_count);
  const globalSync=num(row?.globalExchangeSync??row?.details?.global_exchange_sync);
  const oi=num(row?.oiSlope1h??row?.details?.oi_slope_1h),fund=num(row?.funding??row?.details?.funding);
  if(mech!=null)s+=(mech-50)*0.18;
  if(ma!=null)s+=(ma-50)*0.12;
  if(ma20!=null)s+=Math.max(-8,Math.min(8,ma20*18));
  if(obv!=null)s+=Math.max(-8,Math.min(8,obv*16));
  if(accel!=null){if(accel>=1.5&&accel<7)s+=6;else if(accel>=10)s-=8;}
  s+=Math.min(repeat,4)*4;
  if(globalCount!=null)s+=globalCount>=3?8:globalCount>=2?5:-10;
  if(globalSync!=null)s+=(globalSync-.5)*18;
  if(oi!=null&&oi>0&&oi<.08)s+=3;
  if(fund!=null&&Math.abs(fund)<.0005)s+=2;
  if(rise!=null&&rise>20)s-=12; else if(rise!=null&&rise>=0&&rise<=12)s+=4;
  if(row?.recommendationEligible===true||row?.empiricalValidation?.recommendation_eligible===true)s+=5;
  if(row?.empiricalValidation?.lead_core===true)s+=5;
  s-=hardDiscardReasons(row).length*20;
  return +Math.max(0,Math.min(100,s)).toFixed(1);
}

function stageOf(row){
  if(row?.discarded===true)return "DISCARDED";
  if(row?.strictImmediate===true||row?.entryAllowed===true)return "ENTRY";
  if(row?.validationConfidence>=90)return "VALIDATED_90";
  if(row?.recommendationEligible===true)return "VALIDATED";
  if(row?.empiricalValidation?.lead_core===true)return "LEAD";
  return "SCOUT";
}

function scoreLeading(row){
  const ev=obj(row?.empiricalValidation);
  let score=0;
  if(row?.strictImmediate===true)score+=1000;
  if(row?.recommendationEligible===true||ev.recommendation_eligible===true)score+=320;
  if(ev.lead_core===true)score+=260;
  score+=Math.min(Math.max(0,Number(row?.repeatCount)||0),4)*28;
  const mechanical=num(row?.mechanicalScore);if(mechanical!=null)score+=Math.max(0,Math.min(100,mechanical));
  const ma=num(row?.maAlignment);if(ma!=null)score+=Math.max(0,Math.min(100,ma))*0.45;
  const ma20=num(row?.ma20Slope);if(ma20!=null)score+=Math.max(-1,Math.min(1,ma20))*35;
  const obv=num(row?.obv1h);if(obv!=null)score+=Math.max(-1,Math.min(1,obv))*30;
  const accel=num(row?.volumeAccel5m);if(accel!=null&&accel>0&&accel<10)score+=Math.min(accel,6)*4;
  const rise=num(row?.riseSinceFirstPct);if(rise!=null){if(rise>20)score-=180;else if(rise>12)score-=100;else if(rise>7)score-=45;else if(rise>=0)score+=12;}
  const age=num(row?.candidateAgeMin);if(age!=null)score-=Math.min(Math.max(age,0),30)*2.5;
  const rank=num(row?.rank);if(rank!=null)score-=Math.max(0,rank-1)*2;
  score+=(num(row?.validationConfidence)||0)*2;
  return +score.toFixed(2);
}

function decorate(row){
  const discardReasons=hardDiscardReasons(row);
  const validationConfidence=confidenceScore(row);
  const discarded=discardReasons.length>0;
  const reasons=lagReasons(row),missing=missingLeadConditions(row);
  const lifecycleState=discarded?"DISCARDED":validationConfidence>=90?"VALIDATED_90":validationConfidence>=75?"REVALIDATE":"WATCH";
  const base={...row,validationConfidence,discarded,discardReasons,lifecycleState};
  return {...base,top3Stage:stageOf(base),top3LeadScore:scoreLeading(base),missingLeadConditions:missing,lagReasons:reasons,isLagging:reasons.length>0};
}

function selectLeadingTop3(rows,{limit=3}={}){
  const decorated=(Array.isArray(rows)?rows:[]).map(decorate);
  const discarded=decorated.filter(r=>r.discarded).sort((a,b)=>(b.validationConfidence||0)-(a.validationConfidence||0));
  const usable=decorated.filter(r=>!r.discarded&&!r.isLagging&&passesTop3Gate(r))
    .sort((a,b)=>b.top3LeadScore-a.top3LeadScore||(Number(a.rank)||999)-(Number(b.rank)||999));
  const top3=usable.slice(0,limit).map((r,i)=>({...r,top3Rank:i+1}));
  const selected=new Set(top3.map(r=>String(r.market||"")));
  const nearMiss=decorated.filter(r=>!r.discarded&&!selected.has(String(r.market||""))).sort((a,b)=>{
    const ah=a.isLagging?1:0,bh=b.isLagging?1:0;if(ah!==bh)return ah-bh;
    return (b.validationConfidence||0)-(a.validationConfidence||0)||b.top3LeadScore-a.top3LeadScore;
  }).slice(0,limit).map((r,i)=>({...r,nearMissRank:i+1}));
  return {top3,nearMiss,discarded:discarded.slice(0,limit)};
}

module.exports={decorate,hardDiscardReasons,confidenceScore,lagReasons,missingLeadConditions,passesTop3Gate,scoreLeading,selectLeadingTop3,stageOf};
