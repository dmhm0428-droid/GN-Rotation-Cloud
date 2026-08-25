"use strict";

function clamp(value,min=0,max=100){return Math.max(min,Math.min(max,value));}
function asNumber(value,fallback=null){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function stageRank(status){return ({WAIT:0,SCOUT:1,CONFIRM_WAIT:2,ENTRY:3,NO_CHASE:1})[String(status||"").toUpperCase()]??0;}
function flowStage(score,overheated=false,weakening=false){if(overheated)return "OVERHEAT";if(weakening)return "EXIT";if(score>=72)return "LEADER_HOLD";if(score>=55)return "LEADER_START";return "WATCH";}

function summarizeHistory(rows){
  const ordered=(rows||[]).slice().sort((a,b)=>new Date(a.ts)-new Date(b.ts));
  if(!ordered.length)return null;
  const latest=ordered.at(-1),first=ordered[0];
  const top3=ordered.filter(x=>asNumber(x.rank,99)<=3).length;
  const top10=ordered.filter(x=>asNumber(x.rank,99)<=10).length;
  const stages=ordered.map(x=>stageRank(x.status));
  let progress=0;for(let i=1;i<stages.length;i++)if(stages[i]>stages[i-1])progress++;
  let regress=0;for(let i=1;i<stages.length;i++)if(stages[i]<stages[i-1])regress++;
  const ranks=ordered.map(x=>asNumber(x.rank,99));
  const rankImprovement=ranks.length>1?ranks[0]-ranks.at(-1):0;
  const vols=ordered.map(x=>asNumber(x.volume_ratio15m,0));
  const volAcceleration=vols.length>1?vols.at(-1)-vols[0]:0;
  const obvs=ordered.map(x=>asNumber(x.details?.obv?.direction,0));
  const positiveObv=obvs.filter(x=>x>0).length;
  const confirmed=ordered.some(x=>x.details?.confirmation?.confirmed===true||String(x.status).toUpperCase()==="ENTRY");
  const max15=Math.max(...ordered.map(x=>asNumber(x.return15m,0)));
  const latest15=asNumber(latest.return15m,0);
  const late=latest.details?.late_pump||{};
  const overheated=late.blocked===true||String(latest.status).toUpperCase()==="NO_CHASE"||asNumber(late.rsi14,0)>=75||max15>=.08;
  const weakening=(ordered.length>=3&&regress>=2)||(top3>=1&&asNumber(latest.rank,99)>15&&latest15<.01);
  return {first,latest,count:ordered.length,top3,top10,progress,regress,rankImprovement,volAcceleration,positiveObv,confirmed,max15,latest15,overheated,weakening};
}

function scoreLeaderFlow(history,current){
  const h=summarizeHistory(history);
  if(!h)return {leaderFlowScore:50,leaderFlowStage:"WATCH",leaderFlowReasons:["history unavailable"]};
  let score=20;const reasons=[];
  score+=Math.min(24,h.top3*6);if(h.top3>=2)reasons.push(`TOP3 ${h.top3}회`);
  score+=Math.min(12,h.top10*2);if(h.top10>=3)reasons.push(`상위권 지속 ${h.top10}회`);
  score+=Math.min(14,h.progress*7);if(h.progress>0)reasons.push("상태 단계 상승");
  score+=clamp(h.rankImprovement*1.2,0,10);if(h.rankImprovement>=3)reasons.push(`순위 +${h.rankImprovement}`);
  score+=clamp(h.volAcceleration*5,0,10);if(h.volAcceleration>=.5)reasons.push("거래대금 가속");
  score+=Math.min(8,h.positiveObv*2);if(h.positiveObv>=3)reasons.push("OBV 지속 유입");
  if(h.confirmed){score+=10;reasons.push("ENTRY 재확인");}
  if(current?.details?.structure?.higher_low_15m===true){score+=5;reasons.push("15분 저점 상승");}
  if(h.overheated){score-=18;reasons.push("과열/추격금지");}
  if(h.weakening){score-=15;reasons.push("주도 이탈");}
  if(h.regress>=2)score-=8;
  score=clamp(score);
  return {leaderFlowScore:+score.toFixed(2),leaderFlowStage:flowStage(score,h.overheated,h.weakening),leaderFlowReasons:reasons.slice(0,7)};
}

function firstFinite(...values){for(const value of values){const n=Number(value);if(Number.isFinite(n))return n;}return null;}
function todayEdgeScore(row){
  // 목적: "좋은 코인"이 아니라 지금 들어가 오늘 안에 먹을 공간이 남은 코인을 우선한다.
  // 15m/1h = 당장 갈 힘, 4h/day/week 계열 = 머리 위 저항/매물 공간 확인.
  const d=row?.details||{};
  const dailyDistance=firstFinite(row.dailyResistanceDistance,d.daily_ignition?.resistance_distance,d.daily?.resistance_distance);
  const supplyDistance=firstFinite(row.nearestSupplyDistance,d.overhead_supply?.nearest_distance,d.supply?.nearest_distance);
  const intradayDistance=firstFinite(row.resistanceProximity15m,d.structure?.resistance_proximity_15m);

  const rooms=[];
  if(Number.isFinite(dailyDistance)&&dailyDistance<0)rooms.push(-dailyDistance);
  if(Number.isFinite(supplyDistance)&&supplyDistance>=0)rooms.push(supplyDistance);
  if(Number.isFinite(intradayDistance)&&intradayDistance<0)rooms.push(-intradayDistance);
  const headroom=rooms.length?Math.min(...rooms):null;

  let roomScore=50;
  if(Number.isFinite(headroom)){
    if(headroom>=.08)roomScore=100;
    else if(headroom>=.05)roomScore=88;
    else if(headroom>=.03)roomScore=72;
    else if(headroom>=.02)roomScore=56;
    else if(headroom>=.012)roomScore=38;
    else if(headroom>=.006)roomScore=20;
    else roomScore=5;
  }

  const ret15=asNumber(row.return15m,0);
  const turnover=firstFinite(row.turnoverGrowth15m,row.volume_ratio15m,d.volume?.growth15m)??0;
  const obv=firstFinite(row.obvDirection,d.obv?.direction)??0;
  const higherLow=row.higherLow15m===true||d.structure?.higher_low_15m===true;
  const structure=String(row.structure1h||d.structure?.structure_1h||"");

  let powerScore=45;
  powerScore+=clamp(turnover*18,-20,25);
  powerScore+=clamp(obv*22,-18,22);
  if(higherLow)powerScore+=8;
  if(structure==="sideways_breakout")powerScore+=12;
  else if(structure==="uptrend")powerScore+=7;
  else if(structure==="downtrend")powerScore-=14;
  if(ret15>0&&ret15<=.035)powerScore+=8;
  if(ret15>=.05)powerScore-=8;
  if(ret15>=.08)powerScore-=18;
  powerScore=clamp(powerScore);

  let score=roomScore*.62+powerScore*.38;
  let blocked=false;
  const reasons=[];
  if(Number.isFinite(headroom))reasons.push(`상단여유 ${(headroom*100).toFixed(1)}%`);else reasons.push("상단여유 데이터 부족");
  if(powerScore>=65)reasons.push("장중 수급/가속 양호");
  if(Number.isFinite(headroom)&&headroom<.008){score=Math.min(score,28);blocked=true;reasons.push("바로 위 저항");}
  else if(Number.isFinite(headroom)&&headroom<.015){score=Math.min(score,45);reasons.push("수익공간 좁음");}
  if(ret15>=.08){score=Math.min(score,38);blocked=true;reasons.push("이미 단기 급등");}

  return {todayEdgeScore:+clamp(score).toFixed(2),todayHeadroom:Number.isFinite(headroom)?+headroom.toFixed(4):null,todayPowerScore:+powerScore.toFixed(2),todayEdgeBlocked:blocked,todayEdgeReasons:reasons.slice(0,4)};
}

function blendTop3Score(row,leaderFlow,marketScore=50,aiBias=0){
  const base=asNumber(row.score,0);
  const market=clamp(asNumber(marketScore,50));
  const ai=clamp(50+asNumber(aiBias,0)*50);
  const context=(market*.6+ai*.4);
  const edge=todayEdgeScore(row);
  const latePenalty=Math.min(8,Math.max(0,asNumber(row.details?.late_pump?.penalty,row.latePumpPenalty??0)/10));

  // TODAY EDGE가 1순위. 기존 스캐너/히스토리/시장점수는 확인용으로 낮춘다.
  let final=clamp(edge.todayEdgeScore*.50+base*.22+leaderFlow.leaderFlowScore*.16+context*.12-latePenalty);
  if(edge.todayEdgeBlocked)final=Math.min(final,49);
  if(edge.todayHeadroom!=null&&edge.todayHeadroom<.015)final=Math.min(final,54);

  return {...row,...leaderFlow,...edge,top3FinalScore:+final.toFixed(2),score:+final.toFixed(2)};
}

module.exports={scoreLeaderFlow,blendTop3Score,summarizeHistory,flowStage,todayEdgeScore};
