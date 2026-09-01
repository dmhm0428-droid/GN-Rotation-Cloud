"use strict";

function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function obj(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}

function lagReasons(row){
  const ev=obj(row?.empiricalValidation);
  const reasons=[];
  if(ev.lagging===true)reasons.push("후행 판정");
  const ma=num(row?.maAlignment),ma20=num(row?.ma20Slope),obv=num(row?.obv1h),accel=num(row?.volumeAccel5m),age=num(row?.candidateAgeMin);
  if(ma!=null&&ma<40)reasons.push("MA정렬 40% 미만");
  if(ma20!=null&&ma20<=0)reasons.push("MA20 기울기 0 이하");
  if(obv!=null&&obv<=0)reasons.push("OBV1H 0 이하");
  if(accel!=null&&accel>=10)reasons.push("5분 거래량가속 10배 이상 과열");
  if(age!=null&&age>20)reasons.push("20분 이상 재등장 없음");
  const stage=String(row?.precursorStage||row?.details?.precursor?.confidence_stage||"").toUpperCase();
  if(stage==="REJECT_DECAY")reasons.push("전조 약화");
  return [...new Set(reasons)];
}

function missingLeadConditions(row){
  const missing=[];
  const ma=num(row?.maAlignment),ma20=num(row?.ma20Slope),obv=num(row?.obv1h),accel=num(row?.volumeAccel5m);
  const repeat=Math.max(0,Number(row?.repeatCount)||0);
  if(ma==null)missing.push("MA정렬 데이터"); else if(ma<60)missing.push(`MA정렬 ${ma.toFixed(0)}% < 60%`);
  if(ma20==null)missing.push("MA20 기울기"); else if(ma20<0.10)missing.push(`MA20 ${ma20.toFixed(2)} < 0.10`);
  if(obv==null)missing.push("OBV1H"); else if(obv<0.10)missing.push(`OBV1H ${obv.toFixed(2)} < 0.10`);
  if(accel==null)missing.push("5분 거래량가속"); else if(accel>=10)missing.push(`5분가속 ${accel.toFixed(1)}배 ≥ 10배`);
  if(repeat<2)missing.push(`반복 ${repeat}회 < 2회`);
  return missing;
}

function stageOf(row){
  if(row?.strictImmediate===true||row?.entryAllowed===true)return "ENTRY";
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
  const repeat=Math.max(0,Number(row?.repeatCount)||0);score+=Math.min(repeat,4)*28;
  const mechanical=num(row?.mechanicalScore);if(mechanical!=null)score+=Math.max(0,Math.min(100,mechanical));
  const ma=num(row?.maAlignment);if(ma!=null)score+=Math.max(0,Math.min(100,ma))*0.45;
  const ma20=num(row?.ma20Slope);if(ma20!=null)score+=Math.max(-1,Math.min(1,ma20))*35;
  const obv=num(row?.obv1h);if(obv!=null)score+=Math.max(-1,Math.min(1,obv))*30;
  const accel=num(row?.volumeAccel5m);if(accel!=null&&accel>0&&accel<10)score+=Math.min(accel,6)*4;
  const rise=num(row?.riseSinceFirstPct);
  if(rise!=null){if(rise>20)score-=180;else if(rise>12)score-=100;else if(rise>7)score-=45;else if(rise>=0)score+=12;}
  const age=num(row?.candidateAgeMin);if(age!=null)score-=Math.min(Math.max(age,0),30)*2.5;
  const rank=num(row?.rank);if(rank!=null)score-=Math.max(0,rank-1)*2;
  return +score.toFixed(2);
}

function decorate(row){
  const reasons=lagReasons(row),missing=missingLeadConditions(row);
  return {...row,
    top3Stage:stageOf(row),
    top3LeadScore:scoreLeading(row),
    missingLeadConditions:missing,
    lagReasons:reasons,
    isLagging:reasons.length>0
  };
}

function selectLeadingTop3(rows,{limit=3}={}){
  const decorated=(Array.isArray(rows)?rows:[]).map(decorate);
  const usable=decorated.filter(r=>!r.isLagging).sort((a,b)=>b.top3LeadScore-a.top3LeadScore||(Number(a.rank)||999)-(Number(b.rank)||999));
  const top3=usable.slice(0,limit).map((r,i)=>({...r,top3Rank:i+1}));
  const selected=new Set(top3.map(r=>String(r.market||"")));
  const nearMiss=decorated.filter(r=>!selected.has(String(r.market||""))).sort((a,b)=>{
    const ah=a.isLagging?1:0,bh=b.isLagging?1:0;
    if(ah!==bh)return ah-bh;
    return b.top3LeadScore-a.top3LeadScore;
  }).slice(0,limit).map((r,i)=>({...r,nearMissRank:i+1}));
  return {top3,nearMiss};
}

module.exports={decorate,lagReasons,missingLeadConditions,scoreLeading,selectLeadingTop3,stageOf};
