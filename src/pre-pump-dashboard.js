"use strict";

// GN PIVOT short-term action dashboard.
// Entry approval stays strict, but post-entry management is explicitly intraday:
// take profit early, keep only qualified runners, never average down into a failed first wave.

const LIVE_ENABLED=/^(1|true|yes|on)$/i.test(String(process.env.GN_TOP3_LIVE_ENABLED||"false"));
const MIN_SCORE=75;
const MAX_ENTRY_AGE_MS=20*60*1000;
const TRACK_WINDOW_MS=18*60*60*1000;
const FRESH_TRACK_MS=35*60*1000;
const ACTIONABLE=new Set(["ENTRY"]);

const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
const pct=(base,value)=>{base=num(base);value=num(value);return base>0&&value>0?((value/base)-1)*100:null;};
const ageMs=ts=>Date.now()-new Date(ts).getTime();

function detailsOf(row){return row?.details||{};}
function explicitNoChase(row){
  const d=detailsOf(row);
  const late=d.late_pump||{};
  return String(row?.status||"").toUpperCase()==="NO_CHASE"||d.no_chase===true||d.market_block===true||late.no_chase===true||late.latePumpRisk===true||late.blocked===true;
}
function mandatoryGatesPass(row){
  const d=detailsOf(row);
  return d.entry_allowed===true&&d.five_ai_gate_ok===true&&d.quality_ok===true&&d.entry_sanity_ok===true&&d.global_spot_ok===true&&d.multi_exchange_ok===true&&d.onchain_ok===true&&d.derivatives_ok===true&&d.multi_timeframe_ok===true&&d.cumulative_flow_ok===true&&d.support_resistance_ok===true&&d.risk_reward_ok===true&&d.market_block!==true&&d.no_chase!==true;
}
function signalApproved(row,{checkAge=true}={}){
  if(!row)return false;
  const score=num(row.score),price=num(row.krw_price),entry=num(row.recommended_entry_krw),lo=num(row.recommended_entry_low),hi=num(row.recommended_entry_high);
  if(!ACTIONABLE.has(String(row.status||"").toUpperCase()))return false;
  if(score==null||score<MIN_SCORE)return false;
  if(!(price>0)||!(entry>0)||!(lo>0)||!(hi>=lo))return false;
  if(checkAge){const age=ageMs(row.ts);if(!Number.isFinite(age)||age<0||age>MAX_ENTRY_AGE_MS)return false;}
  if(!mandatoryGatesPass(row))return false;
  if(price<lo||price>hi)return false;
  return true;
}
function hardValidated(row){return signalApproved(row,{checkAge:true});}

function marketTrend(rows){
  const list=(rows||[]).filter(Boolean);
  const latest=num(list[0]?.market_score);
  const oldest=num(list[list.length-1]?.market_score);
  return {score:latest,delta:latest!=null&&oldest!=null?latest-oldest:null};
}

function maxObservedPrice(history,signalTime,fallback){
  let max=num(fallback)||0;
  for(const row of history||[]){
    const ts=new Date(row?.ts).getTime();
    const px=num(row?.krw_price);
    if(Number.isFinite(ts)&&ts>=signalTime&&px!=null&&px>max)max=px;
  }
  return max||null;
}

function profitPlan(mfe){
  const m=num(mfe)||0;
  if(m>=25)return {tier:3,floorPct:Math.max(8,+(m-8).toFixed(1)),nextTakeProfitPct:null,baseRunnerRatio:"25~50%"};
  if(m>=15)return {tier:2,floorPct:3,nextTakeProfitPct:25,baseRunnerRatio:"50% 이하"};
  if(m>=8)return {tier:1,floorPct:0,nextTakeProfitPct:15,baseRunnerRatio:"75% 이하"};
  return {tier:0,floorPct:null,nextTakeProfitPct:8,baseRunnerRatio:null};
}

function continuityState({signal,current,market,repeatCount,history=[]}){
  const signalScore=num(signal.score)||0;
  const currentScore=num(current?.score);
  const currentPrice=num(current?.krw_price);
  const lo=num(signal.recommended_entry_low);
  const hi=num(signal.recommended_entry_high);
  const entry=num(signal.recommended_entry_krw);
  const scoreDrop=currentScore==null?null:signalScore-currentScore;
  const gain=pct(entry,currentPrice);
  const currentAge=current?.ts?ageMs(current.ts):Infinity;
  const marketScore=num(market?.score);
  const marketDelta=num(market?.delta);
  const marketBroken=(marketScore!=null&&marketScore<45)||(marketDelta!=null&&marketDelta<=-10);
  const belowBand=currentPrice!=null&&lo>0&&currentPrice<lo;
  const deepBelow=currentPrice!=null&&lo>0&&currentPrice<lo*.97;
  const scoreWeak=scoreDrop!=null&&scoreDrop>=12;
  const scoreBroken=scoreDrop!=null&&scoreDrop>=18;
  const signalTime=new Date(signal.ts).getTime();
  const maxPrice=maxObservedPrice(history,signalTime,currentPrice||entry);
  const mfe=pct(entry,maxPrice);
  const giveback=mfe!=null&&gain!=null?Math.max(0,mfe-gain):null;
  const plan=profitPlan(mfe);
  const base={gain,scoreDrop,repeatCount,mfe,peakPrice:maxPrice,giveback,profitFloorPct:plan.floorPct,nextTakeProfitPct:plan.nextTakeProfitPct,averageDownAllowed:false,runnerAllowed:false};

  if(!current||!Number.isFinite(currentAge)||currentAge>FRESH_TRACK_MS){
    return {...base,action:"보유점검",tone:"warn",newEntryAllowed:false,reason:"단타 추적값이 35분 이상 갱신되지 않음 · 신규진입/물타기 금지",stale:true};
  }
  if(explicitNoChase(current)){
    const action=(mfe||0)>=8?"수익보호":"매도준비";
    return {...base,action,tone:"warn",newEntryAllowed:false,reason:(mfe||0)>=8?"과열/NO_CHASE 확인 · 이미 난 수익을 되돌리지 말고 분할익절 우선":"과열/NO_CHASE 확인 · 신규추격 금지, 반등 시 정리 우선"};
  }

  if((mfe||0)>=25){
    const runnerHealthy=!marketBroken&&!scoreBroken&&!belowBand&&(giveback==null||giveback<=8)&&(gain==null||gain>=plan.floorPct);
    if(runnerHealthy)return {...base,action:"러너유지",tone:"good",newEntryAllowed:false,runnerAllowed:true,reason:`3차 수익권 · 누적 익절 후 ${plan.baseRunnerRatio}만 단타 러너, MFE 대비 -8%p 이내 트레일`};
    return {...base,action:"러너청산",tone:"bad",newEntryAllowed:false,reason:"3차 수익권 이후 되돌림/시장·점수 약화 · 러너 수익 확정"};
  }
  if((mfe||0)>=15){
    const healthy=!marketBroken&&!scoreBroken&&!deepBelow&&(giveback==null||giveback<=6);
    if(healthy)return {...base,action:"2차익절",tone:"good",newEntryAllowed:false,runnerAllowed:true,reason:"MFE +15% 이상 · 추가 25% 익절, 잔여만 당일 러너 심사"};
    return {...base,action:"수익보호",tone:"warn",newEntryAllowed:false,reason:"2차 수익권 이후 되돌림 · 최소 +3% 수익바닥 보호"};
  }
  if((mfe||0)>=8){
    const healthy=!marketBroken&&!scoreBroken&&!deepBelow&&(giveback==null||giveback<=5);
    if(healthy)return {...base,action:"1차익절",tone:"good",newEntryAllowed:false,runnerAllowed:true,reason:"MFE +8% 이상 · 최소 25% 1차 익절, 잔여 손실 허용선은 본전권"};
    return {...base,action:"수익보호",tone:"warn",newEntryAllowed:false,reason:"1차 수익권 이후 되돌림 · Winner→Loser 전환 금지, 본전권 이상 보호"};
  }

  if((gain!=null&&gain<0)&&(deepBelow||scoreWeak||marketBroken)){
    return {...base,action:"물타기금지",tone:"bad",newEntryAllowed:false,reason:"첫 파동 진입 후 가격/점수/시장 약화 · 약한 종목 추가매수 금지"};
  }
  if((deepBelow&&scoreWeak)||(belowBand&&scoreBroken&&marketBroken)){
    return {...base,action:"매도준비",tone:"bad",newEntryAllowed:false,reason:"진입밴드 이탈과 펌프/시장 약화가 겹침 · 단타 실패 처리"};
  }
  if(marketBroken||scoreBroken||belowBand){
    return {...base,action:"보유점검",tone:"warn",newEntryAllowed:false,reason:"시장/점수/가격 중 하나 약화 · 물타기 없이 다음 스캔에서 반등 구조만 확인"};
  }
  if(currentPrice!=null&&hi>0&&currentPrice>hi){
    return {...base,action:"단타보유",tone:"good",newEntryAllowed:false,runnerAllowed:true,reason:"진입밴드 돌파 후 단타 구조 유지 · +8% 도달 전까지 추격매수 없이 보유"};
  }
  if(currentPrice!=null&&lo>0&&hi>=lo&&currentPrice>=lo&&currentPrice<=hi&&currentScore!=null&&currentScore>=70&&!marketBroken){
    return {...base,action:"진입유지",tone:"good",newEntryAllowed:true,reason:"승인된 진입밴드와 시장/펌프 구조 유지 · 단타 진입만 허용"};
  }
  return {...base,action:"단타보유",tone:"neutral",newEntryAllowed:false,reason:"기존 단타 진입 승인 유효 · 신규추격/물타기는 금지"};
}

function formatCandidate(row,rank,extra={}){
  const signal=extra.signal||row;
  return {
    rank,
    market:row.market,
    score:num(row.score),
    scannerStatus:row.status,
    status:extra.status||"진입승인 · 모든 필수 게이트 통과",
    action:extra.action||"진입",
    actionTone:extra.tone||"good",
    actionReason:extra.reason||"MTF·누적수급·글로벌 현물·멀티거래소·온체인·파생·지지/저항·손익비·진입가 검증 완료",
    hardBlock:false,
    newEntryAllowed:extra.newEntryAllowed??true,
    repeatCount:extra.repeatCount??1,
    signalTs:signal.ts,
    signalScore:num(signal.score),
    signalPrice:num(signal.krw_price),
    krwPrice:num(row.krw_price),
    gainFromEntryPct:extra.gain??pct(signal.recommended_entry_krw,row.krw_price),
    mfePct:extra.mfe??pct(signal.recommended_entry_krw,row.krw_price),
    peakPrice:extra.peakPrice??num(row.krw_price),
    givebackFromMfePct:extra.giveback??0,
    profitFloorPct:extra.profitFloorPct??null,
    nextTakeProfitPct:extra.nextTakeProfitPct??8,
    runnerAllowed:extra.runnerAllowed===true,
    averageDownAllowed:false,
    tradeMode:"SCALP_INTRADAY",
    scoreDropFromSignal:extra.scoreDrop??0,
    recommendedEntry:num(signal.recommended_entry_krw),
    recommendedEntryLow:num(signal.recommended_entry_low),
    recommendedEntryHigh:num(signal.recommended_entry_high),
    updated_at:row.ts,
    stale:extra.stale===true,
    maintenance:false
  };
}

async function readRecentHistory(db){
  const q=await db.from("gn_pre_pump_snapshots")
    .select("run_id,rank,market,score,status,krw_price,recommended_entry_krw,recommended_entry_low,recommended_entry_high,details,ts")
    .order("ts",{ascending:false})
    .limit(720);
  if(q.error)throw q.error;
  const cutoff=Date.now()-TRACK_WINDOW_MS;
  return (q.data||[]).filter(r=>new Date(r.ts).getTime()>=cutoff);
}
async function readMarketTrend(db){
  try{
    const q=await db.from("gn_market_snapshots").select("ts,market_score,action,regime").order("ts",{ascending:false}).limit(4);
    return q.error?{score:null,delta:null}:marketTrend(q.data||[]);
  }catch{return {score:null,delta:null};}
}

async function loadLatestPrePump(db){
  if(!LIVE_ENABLED)return [];
  const latest=await db.from("gn_pre_pump_snapshots").select("run_id,ts").order("ts",{ascending:false}).limit(1).maybeSingle();
  if(latest.error)throw latest.error;
  if(!latest.data?.run_id)return [];

  const [currentQuery,history,market]=await Promise.all([
    db.from("gn_pre_pump_snapshots")
      .select("rank,market,score,status,krw_price,recommended_entry_krw,recommended_entry_low,recommended_entry_high,details,ts")
      .eq("run_id",latest.data.run_id)
      .order("rank",{ascending:true})
      .limit(20),
    readRecentHistory(db),
    readMarketTrend(db)
  ]);
  if(currentQuery.error)throw currentQuery.error;
  const currentRows=currentQuery.data||[];
  const currentByMarket=new Map(currentRows.map(r=>[r.market,r]));

  const byMarket=new Map();
  for(const r of history){if(!byMarket.has(r.market))byMarket.set(r.market,[]);byMarket.get(r.market).push(r);}
  for(const arr of byMarket.values())arr.sort((a,b)=>new Date(b.ts)-new Date(a.ts));

  const output=[];
  const seen=new Set();

  // 1) Fresh strict ENTRY approvals first. Original entry anchor never moves.
  const freshApproved=currentRows.filter(hardValidated).sort((a,b)=>Number(b.score)-Number(a.score));
  for(const row of freshApproved){
    const hist=byMarket.get(row.market)||[row];
    const signal=hist.slice().reverse().find(r=>signalApproved(r,{checkAge:false}))||row;
    const signalTime=new Date(signal.ts).getTime();
    const repeatCount=hist.filter(r=>new Date(r.ts).getTime()>=signalTime).length||1;
    const repeated=new Date(signal.ts).getTime()!==new Date(row.ts).getTime();
    const state=continuityState({signal,current:row,market,repeatCount,history:hist});
    const action=repeated?state.action:"진입";
    const tone=repeated?state.tone:"good";
    const newEntryAllowed=repeated?state.newEntryAllowed:true;
    const status=repeated?`${action} · 최초 ENTRY ${repeatCount}회 단타추적${newEntryAllowed?" · 신규진입 가능":""}`:`진입 · 최초승인 · 단타추적 시작`;
    output.push(formatCandidate(row,output.length+1,{signal,...state,action,tone,newEntryAllowed,repeatCount,status,reason:repeated?state.reason:undefined}));
    seen.add(row.market);
  }

  // 2) Keep approved entries visible only for the intraday tracking window.
  for(const [marketName,hist] of byMarket){
    if(seen.has(marketName))continue;
    const signal=hist.slice().reverse().find(r=>signalApproved(r,{checkAge:false}));
    if(!signal)continue;
    const signalTime=new Date(signal.ts).getTime();
    if(Date.now()-signalTime>TRACK_WINDOW_MS)continue;
    const latestObserved=currentByMarket.get(marketName)||hist[0]||signal;
    const repeatCount=hist.filter(r=>new Date(r.ts).getTime()>=signalTime).length;
    const state=continuityState({signal,current:latestObserved,market,repeatCount,history:hist});
    const status=`${state.action} · 진입 후 ${repeatCount}회 단타추적${state.newEntryAllowed?" · 신규진입 가능":""}`;
    output.push(formatCandidate(latestObserved,output.length+1,{signal,...state,status}));
    seen.add(marketName);
  }

  const priority={"러너청산":0,"수익보호":1,"2차익절":2,"1차익절":3,"매도준비":4,"물타기금지":5,"진입":6,"진입유지":7,"러너유지":8,"단타보유":9,"보유점검":10};
  return output.sort((a,b)=>(priority[a.action]??99)-(priority[b.action]??99)||Number(b.score)-Number(a.score)).slice(0,10).map((r,i)=>({...r,rank:i+1}));
}

function createLatestPrePumpHandler({db,load=loadLatestPrePump}){
  return async function(_req,res){
    try{
      const rows=await load(db);
      res.setHeader("Cache-Control","no-store");
      return res.json(rows);
    }catch(error){
      return res.status(503).json({error:"TOP3_MAINTENANCE",message:"TOP3 action data could not be validated from fresh GN sources."});
    }
  };
}

function isDisplayableTopCandidate(row){return LIVE_ENABLED&&hardValidated(row);}
function classifyAction(){return {action:"검증중",tone:"muted",reason:"최신 GN 추적값 검증 중",hardBlock:true};}
function loadMultiTimeframe(){return Promise.resolve({available:false,error:"TOP3_MAINTENANCE"});}
function frameTrend(){return {available:false,score:null,label:"UNKNOWN"};}
function volumeContext(){return {score:null};}
function aggregateCandles(){return [];}
function recentReturn(){return null;}

module.exports={
  classifyAction,
  continuityState,
  createLatestPrePumpHandler,
  formatCandidate,
  isDisplayableTopCandidate,
  loadLatestPrePump,
  loadMultiTimeframe,
  frameTrend,
  volumeContext,
  aggregateCandles,
  recentReturn,
  hardValidated,
  signalApproved
};