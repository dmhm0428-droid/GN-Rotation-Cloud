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

function blendTop3Score(row,leaderFlow,marketScore=50,aiBias=0){
  const base=asNumber(row.score,0);
  const market=clamp(asNumber(marketScore,50));
  const ai=clamp(50+asNumber(aiBias,0)*50);
  const context=(market*.6+ai*.4);
  const latePenalty=Math.min(5,Math.max(0,asNumber(row.details?.late_pump?.penalty,0)/14));
  const final=clamp(base*.60+leaderFlow.leaderFlowScore*.25+context*.10-latePenalty);
  return {...row,...leaderFlow,top3FinalScore:+final.toFixed(2),score:+final.toFixed(2)};
}

module.exports={scoreLeaderFlow,blendTop3Score,summarizeHistory,flowStage};
