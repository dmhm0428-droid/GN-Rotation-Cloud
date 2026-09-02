"use strict";

const FRESH_MS=20*60*1000;
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const obj=v=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));

function ageMin(ts,now=Date.now()){
  const t=new Date(ts||0).getTime();
  return Number.isFinite(t)&&t>0?(now-t)/60000:null;
}
function fresh(ts,now=Date.now(),maxMs=FRESH_MS){
  const a=ageMin(ts,now);return a!=null&&a>=0&&a*60000<=maxMs;
}
function lookbackValue(rows,key,referenceTs,minutes=60){
  const ref=new Date(referenceTs||0).getTime();if(!Number.isFinite(ref)||ref<=0)return null;
  const target=ref-minutes*60000;
  const candidates=(rows||[]).map(r=>({v:num(r?.[key]),t:new Date(r?.ts||0).getTime()})).filter(x=>x.v!=null&&Number.isFinite(x.t)&&x.t>0).map(x=>({...x,d:Math.abs(x.t-target)})).sort((a,b)=>a.d-b.d);
  return candidates[0]&&candidates[0].d<=30*60000?candidates[0].v:null;
}
function delta1h(rows,key,current,referenceTs){
  const old=lookbackValue(rows,key,referenceTs,60),now=num(current);return old!=null&&now!=null?+(now-old).toFixed(2):null;
}
function coinPulse(rows,coin,now=Date.now()){
  const series=(rows||[]).filter(r=>String(r?.coin||"").toUpperCase()===coin).filter(r=>fresh(r.ts,now,6*3600000)).sort((a,b)=>new Date(b.ts)-new Date(a.ts));
  const latest=series[0]||null;if(!latest||!fresh(latest.ts,now))return {coin,available:false,current:null,low6h:null,aboveLowPct:null,ageMin:ageMin(latest?.ts,now)};
  const prices=series.map(r=>num(r.krw_price)).filter(v=>v!=null&&v>0);const current=num(latest.krw_price),low6h=prices.length?Math.min(...prices):null;
  return {coin,available:current!=null&&low6h!=null,current,low6h,aboveLowPct:current&&low6h?+((current/low6h-1)*100).toFixed(2):null,ageMin:+ageMin(latest.ts,now).toFixed(1)};
}
function ratePath(macro,events){
  const c=obj(macro?.components),fromMacro=obj(c.RATE_HIKE_PATH),fromEvent=obj(events?.RATE_HIKE_PATH);
  const path=Object.keys(obj(fromMacro.path)).length?obj(fromMacro.path):fromEvent;
  const risk=num(fromMacro.risk)??(num(macro?.policy_score)!=null?100-num(macro.policy_score):null);
  return {risk:risk==null?null:+clamp(risk).toFixed(1),path};
}
function axis(label,pass,detail,available=true){return {label,available:available===true,pass:available===true?pass===true:null,detail};}
function summarize(axes){
  const available=axes.filter(x=>x.available),passed=available.filter(x=>x.pass).length;
  return {passed,available:available.length,score:available.length?Math.round(passed/available.length*100):null,axes};
}
function buildQ4Path({market,macro,marketHistory=[],macroHistory=[],coinRows=[],events={},now=Date.now()}={}){
  const footprint=num(market?.market_score),rates=num(macro?.rates_score),policy=num(macro?.policy_score),commodities=num(macro?.commodities_score),volatility=num(macro?.volatility_score),breadth=num(market?.spot_breadth100);
  const marketFresh=fresh(market?.ts,now),macroFresh=fresh(macro?.ts,now),marketDelta=marketFresh?delta1h(marketHistory,"market_score",footprint,market?.ts):null,ratesDelta=macroFresh?delta1h(macroHistory,"rates_score",rates,macro?.ts):null;
  const btc=coinPulse(coinRows,"BTC",now),eth=coinPulse(coinRows,"ETH",now),rp=ratePath(macro,events),sep=num(rp.path?.september?.hike_25bp_probability),decExtra=num(rp.path?.december?.additional_hike_probability);

  const reversal=summarize([
    axis("장기금리 진정",rates!=null&&(rates>=50||(ratesDelta!=null&&ratesDelta>=5)),`금리점수 ${rates?.toFixed?.(1)??"--"}${ratesDelta!=null?` · 1h ${ratesDelta>=0?"+":""}${ratesDelta.toFixed(1)}`:""}`,macroFresh&&rates!=null),
    axis("Fed 경로 완화",rp.risk!=null&&(rp.risk<=55||policy>=45),`금리경로 위험 ${rp.risk??"--"}${sep!=null?` · 9월 ${sep.toFixed(1)}%`:""}${decExtra!=null?` · 12월 추가 ${decExtra.toFixed(1)}%`:""}`,macroFresh&&rp.risk!=null),
    axis("원자재 충격 진정",commodities!=null&&commodities>=50,`원자재점수 ${commodities?.toFixed?.(1)??"--"}`,macroFresh&&commodities!=null),
    axis("시장 폭 회복",breadth!=null&&breadth>=.45,`상승종목 비율 ${breadth!=null?(breadth*100).toFixed(0):"--"}%`,marketFresh&&breadth!=null),
    axis("발자국 회복",footprint!=null&&footprint>=45&&(marketDelta==null||marketDelta>=3),`시장점수 ${footprint?.toFixed?.(1)??"--"}${marketDelta!=null?` · 1h ${marketDelta>=0?"+":""}${marketDelta.toFixed(1)}`:""}`,marketFresh&&footprint!=null),
    axis("BTC·ETH 저점 이격",btc.aboveLowPct!=null&&eth.aboveLowPct!=null&&btc.aboveLowPct>=1.5&&eth.aboveLowPct>=1.5,`BTC +${btc.aboveLowPct??"--"}% · ETH +${eth.aboveLowPct??"--"}% (6h 저점 대비)`,btc.available&&eth.available)
  ]);

  const panic=summarize([
    axis("시장점수 35 이하",footprint!=null&&footprint<=35,`시장점수 ${footprint?.toFixed?.(1)??"--"}`,marketFresh&&footprint!=null),
    axis("금리점수 40 이하",rates!=null&&rates<=40,`금리점수 ${rates?.toFixed?.(1)??"--"}`,macroFresh&&rates!=null),
    axis("Fed 위험 70 이상",rp.risk!=null&&rp.risk>=70,`금리경로 위험 ${rp.risk??"--"}`,macroFresh&&rp.risk!=null),
    axis("상승종목 30% 이하",breadth!=null&&breadth<=.30,`상승종목 ${breadth!=null?(breadth*100).toFixed(0):"--"}%`,marketFresh&&breadth!=null),
    axis("변동성 환경 취약",volatility!=null&&volatility<=45,`변동성점수 ${volatility?.toFixed?.(1)??"--"}`,macroFresh&&volatility!=null),
    axis("원자재 충격 지속",commodities!=null&&commodities<=48,`원자재점수 ${commodities?.toFixed?.(1)??"--"}`,macroFresh&&commodities!=null)
  ]);

  let state="RISK_OFF_WAIT",label="약세 지속",guide="달력보다 금리·Fed 경로·시장 폭·BTC/ETH 저점 회복을 우선 확인";
  if(reversal.available<4||panic.available<4){state="DATA_WAIT";label="데이터대기";guide="최신 데이터 축이 4개 미만이라 경로판정 보류";}
  else if(footprint>=65&&rates>=55&&reversal.score>=80){state="RISK_ON";label="위험선호 전환";guide="큰그림과 금리환경이 함께 회복 · TOP3는 종목별 ENTRY 게이트로 선별";}
  else if(reversal.score>=80&&footprint>=50){state="REVERSAL_CONFIRMED";label="반전확인";guide="연말 반등 경로 우위 · 추격보다 눌림/재확인 우선";}
  else if(reversal.score>=60){state="REVERSAL_DETECTED";label="반전감지";guide="바닥 가능성 상승 · 아직 한두 축 확인 필요";}
  else if(panic.score>=75&&reversal.score>=30){state="BOTTOMING_WATCH";label="패닉 속 바닥탐색";guide="하락압력은 강하지만 일부 회복축 등장 · 저점 재시험 여부 확인";}
  else if(panic.score>=75){state="PANIC_EXPANSION";label="패닉확대";guide="9~10월 조정 경로 우세 · 반전축이 최소 4/6으로 올라오기 전 공격매수 보류";}

  return {state,label,guide,reversal,panic,marketDelta1h:marketDelta,ratesDelta1h:ratesDelta,rateHikeRisk:rp.risk,septemberHikeProbability:sep,decemberAdditionalHikeProbability:decExtra,btc,eth,rule:"달력 비가중 · 금리/Fed경로/원자재/시장폭/발자국/BTC·ETH 저점회복 6축 확인"};
}

module.exports={FRESH_MS,ageMin,buildQ4Path,coinPulse,ratePath};
