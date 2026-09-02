"use strict";

// Runtime compatibility layer for GN PIVOT short-term dashboard.
// Goals:
// 1) accept the current v69 scanner schema (5AI can be advisory/stale without blocking),
// 2) surface a conservative 15m early-entry when only the repeat-confirmation blocker remains,
// 3) keep an approved intraday signal visible even after it drops out of the next TOP3 scan,
// 4) refresh the tracked price from Upbit so profit-lock / invalidation logic can continue.

const base = require("./pre-pump-dashboard");

const TRACK_WINDOW_MS = 18 * 60 * 60 * 1000;
const FRESH_SIGNAL_MS = 25 * 60 * 1000;
const MIN_CONFIRMED_SCORE = 75;
const MIN_EARLY_SCORE = 88;

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const ageMs = ts => Date.now() - new Date(ts).getTime();
const pct = (a,b) => { a=num(a); b=num(b); return a>0&&b>0 ? ((b/a)-1)*100 : null; };
const details = row => row?.details || {};

function currentSchemaConfirmed(row,{checkAge=true}={}){
  if(!row || String(row.status||"").toUpperCase() !== "ENTRY") return false;
  const d=details(row), ex=d.expansion||{}, ob=d.orderbook||{}, st=d.structure||{};
  const score=num(row.score), px=num(row.krw_price), lo=num(row.recommended_entry_low), hi=num(row.recommended_entry_high);
  if(score==null || score<MIN_CONFIRMED_SCORE || !(px>0) || !(lo>0) || !(hi>=lo)) return false;
  if(checkAge){ const a=ageMs(row.ts); if(!Number.isFinite(a)||a<0||a>FRESH_SIGNAL_MS) return false; }
  if(d.entry_allowed!==true || d.mechanical_entry_ready!==true) return false;
  if(d.blocked_by_five_ai_gate===true || d.market_block===true || d.no_chase===true) return false;
  if(ex.global_spot_ok!==true || !Array.isArray(ex.global_venues) || ex.global_venues.length<2) return false;
  if(ex.derivatives_available===true && ex.derivatives_ok!==true) return false;
  if(ex.onchain_hard_negative===true) return false;
  if(ob.ok!==true) return false;
  if(st.one_hour_ok!==true) return false;
  const rr=num(st.rr); if(rr!=null && rr<1.5) return false;
  return px>=lo*.995 && px<=hi*1.01;
}

function early15Approved(row,{checkAge=true}={}){
  if(!row || String(row.status||"").toUpperCase() !== "SCOUT") return false;
  if(num(row.rank)!=null && num(row.rank)>3) return false;
  const score=num(row.score); if(score==null || score<MIN_EARLY_SCORE) return false;
  if(checkAge){ const a=ageMs(row.ts); if(!Number.isFinite(a)||a<0||a>FRESH_SIGNAL_MS) return false; }

  const d=details(row), p=d.precursor||{}, ma=p.ma_transition||{}, lead=d.lead_lag||{}, ex=d.expansion||{}, ob=d.orderbook||{}, st=d.structure||{};
  const blockers=Array.isArray(d.entry_blockers)?d.entry_blockers:[];
  const allowedBlockers=new Set(["반복/신선전환/순환매 확인대기"]);
  if(blockers.some(x=>!allowedBlockers.has(String(x)))) return false;

  const ret15=num(p.ret_15m_pct) ?? (num(row.return15m)!=null ? num(row.return15m)*100 : null);
  const accel=Math.max(num(p.volume_accel_1m)||0,num(p.volume_accel_5m)||0);
  const align=num(ma.alignment) ?? num(lead.ma_alignment);
  const ma20=num(ma.ma20_slope_3h) ?? num(lead.ma20_slope_3h);
  const ma50=num(ma.ma50_slope_3h) ?? num(lead.ma50_slope_3h);
  const obv=num(ma.obv_direction_1h) ?? num(lead.obv_direction_1h);
  const buy=num(p.buy_aggressor_ratio) ?? num(lead.buy_aggressor_ratio);
  const bid=num(p.bid_imbalance) ?? num(lead.bid_imbalance);
  const stretch=num(ma.stretch20_pct);
  const rise=num(row.rise_since_first)!=null ? num(row.rise_since_first)*100 : num(d.rise_since_first_pct);

  if(ret15==null || ret15 < -0.5 || ret15 > 4.5) return false;
  if(accel < 1.2 || align==null || align < 60) return false;
  if(ma20==null || ma20 < 0.15 || ma50==null || ma50 < 0) return false;
  if(obv==null || obv < 0.12 || buy==null || buy < 0.54 || bid==null || bid < 0.50) return false;
  if(stretch!=null && stretch > 7.5) return false;
  if(rise!=null && rise > 6) return false;
  if(lead.anti_chase!==true) return false;
  if(ex.global_spot_ok!==true || !Array.isArray(ex.global_venues) || ex.global_venues.length<2) return false;
  if(ex.derivatives_available===true && ex.derivatives_ok!==true) return false;
  if(ex.onchain_hard_negative===true || ob.ok!==true || st.one_hour_ok!==true) return false;
  return true;
}

function normalizeSignal(row,phase){
  if(!row) return row;
  const px=num(row.recommended_entry_krw)>0 ? num(row.recommended_entry_krw) : (num(row.recommended_entry_high)||num(row.krw_price));
  return {
    ...row,
    recommended_entry_krw:px,
    recommended_entry_low:num(row.recommended_entry_low)||px,
    recommended_entry_high:num(row.recommended_entry_high)||px,
    details:{...details(row),entry_phase:phase}
  };
}

function signalKind(row,{checkAge=false}={}){
  if(currentSchemaConfirmed(row,{checkAge})) return "CONFIRMED";
  if(early15Approved(row,{checkAge})) return "EARLY15";
  return null;
}

function marketTrend(rows){
  const a=(rows||[]).filter(Boolean), latest=num(a[0]?.market_score), oldest=num(a[a.length-1]?.market_score);
  return {score:latest,delta:latest!=null&&oldest!=null?latest-oldest:null};
}

async function readHistory(db){
  const q=await db.from("gn_pre_pump_snapshots")
    .select("run_id,rank,market,score,status,krw_price,recommended_entry_krw,recommended_entry_low,recommended_entry_high,first_detected_at,first_detected_price,rise_since_first,listing_risk,return15m,details,ts")
    .order("ts",{ascending:false}).limit(720);
  if(q.error) throw q.error;
  const cut=Date.now()-TRACK_WINDOW_MS;
  return (q.data||[]).filter(r=>new Date(r.ts).getTime()>=cut);
}

async function readMarket(db){
  try{
    const q=await db.from("gn_market_snapshots").select("ts,market_score,action,regime").order("ts",{ascending:false}).limit(4);
    return q.error?{score:null,delta:null}:marketTrend(q.data||[]);
  }catch{return {score:null,delta:null};}
}

async function livePrices(markets){
  if(!markets.length) return new Map();
  try{
    const url="https://api.upbit.com/v1/ticker?markets="+encodeURIComponent(markets.join(","));
    const r=await fetch(url,{headers:{accept:"application/json","user-agent":"GN-Pivot-Track-Hotfix"}});
    if(!r.ok) return new Map();
    const rows=await r.json();
    return new Map((rows||[]).map(x=>[String(x.market),num(x.trade_price)]));
  }catch{return new Map();}
}

async function loadCompat(db){
  const enabled=/^(1|true|yes|on)$/i.test(String(process.env.GN_TOP3_LIVE_ENABLED||"false"));
  if(!enabled) return [];

  const latest=await db.from("gn_pre_pump_snapshots").select("run_id,ts").order("ts",{ascending:false}).limit(1).maybeSingle();
  if(latest.error) throw latest.error;
  if(!latest.data?.run_id) return [];

  const [curQ,history,market]=await Promise.all([
    db.from("gn_pre_pump_snapshots")
      .select("run_id,rank,market,score,status,krw_price,recommended_entry_krw,recommended_entry_low,recommended_entry_high,first_detected_at,first_detected_price,rise_since_first,listing_risk,return15m,details,ts")
      .eq("run_id",latest.data.run_id).order("rank",{ascending:true}).limit(20),
    readHistory(db),
    readMarket(db)
  ]);
  if(curQ.error) throw curQ.error;
  const currentRows=curQ.data||[], currentBy=new Map(currentRows.map(r=>[r.market,r]));
  const byMarket=new Map();
  for(const r of history){ if(!byMarket.has(r.market)) byMarket.set(r.market,[]); byMarket.get(r.market).push(r); }
  for(const arr of byMarket.values()) arr.sort((a,b)=>new Date(b.ts)-new Date(a.ts));

  // Identify every market with a real confirmed entry or a conservative 15m early entry in this intraday window.
  const episodes=[];
  for(const [marketName,hist] of byMarket){
    const chronological=hist.slice().reverse();
    const first=chronological.find(r=>signalKind(r,{checkAge:false}));
    if(!first) continue;
    const signalTime=new Date(first.ts).getTime();
    if(Date.now()-signalTime>TRACK_WINDOW_MS) continue;
    const firstKind=signalKind(first,{checkAge:false});
    episodes.push({marketName,hist,first,firstKind,signalTime});
  }

  const missing=episodes.filter(e=>!currentBy.has(e.marketName)).map(e=>e.marketName).slice(0,20);
  const pxMap=await livePrices(missing);
  const output=[];

  for(const ep of episodes){
    const current=currentBy.get(ep.marketName)||ep.hist[0]||ep.first;
    const livePx=pxMap.get(ep.marketName);
    const observed=livePx>0 ? {...current,krw_price:livePx,ts:new Date().toISOString(),synthetic_live:true} : current;
    const nowKind=signalKind(current,{checkAge:true});
    const signal=normalizeSignal(ep.first,ep.firstKind);
    const repeatCount=ep.hist.filter(r=>new Date(r.ts).getTime()>=ep.signalTime).length||1;
    let state=base.continuityState({signal,current:observed,market,repeatCount,history:ep.hist});

    const invalidation=num(signal?.details?.structure?.invalidation) || num(signal?.details?.trade_plan?.invalidation);
    if(invalidation>0 && num(observed.krw_price)>0 && num(observed.krw_price)<invalidation){
      state={...state,action:"매도준비",tone:"bad",newEntryAllowed:false,runnerAllowed:false,averageDownAllowed:false,reason:`단타 무효화선 ${invalidation.toLocaleString()} 이탈 · 물타기 금지`};
    }

    // Fresh 15m early setup: show actionable before the repeat/full-confirmation stage.
    if(nowKind==="EARLY15"){
      state={...state,action:"진입",tone:"good",newEntryAllowed:true,runnerAllowed:true,averageDownAllowed:false,reason:"15분 선행구조: 거래량 가속 + OBV/매수체결 + 1H MA20·50 기울기 개선, 반복확정만 남음"};
    }else if(nowKind==="CONFIRMED" && ep.firstKind==="EARLY15"){
      state={...state,action:state.action==="단타보유"?"진입유지":state.action,tone:"good",reason:"15분 선발대 이후 정식 ENTRY 확인 · 최초 진입가를 유지해 단타 추적"};
    }else if(observed.synthetic_live){
      state={...state,newEntryAllowed:false,reason:(state.reason||"")+" · 현재 TOP3 밖이지만 승인 신호는 당일 추적 유지"};
    }

    const status=nowKind==="EARLY15"
      ? "15분 선발대 · 초기진입"
      : nowKind==="CONFIRMED" && ep.firstKind==="EARLY15"
        ? "ENTRY 확정 · 15분 선발대부터 추적"
        : `${state.action} · 최초 신호 ${repeatCount}회 단타추적`;

    output.push(base.formatCandidate(observed,output.length+1,{signal,...state,status,repeatCount}));
  }

  // If a fresh actionable candidate has no prior episode for some reason, surface it immediately.
  for(const row of currentRows){
    if(output.some(x=>x.market===row.market)) continue;
    const kind=signalKind(row,{checkAge:true}); if(!kind) continue;
    const signal=normalizeSignal(row,kind);
    const state=kind==="EARLY15"
      ? {action:"진입",tone:"good",newEntryAllowed:true,runnerAllowed:true,averageDownAllowed:false,reason:"15분 선행구조 · 반복확정 전 선발대",gain:0,scoreDrop:0,repeatCount:1,mfe:0,peakPrice:num(row.krw_price),giveback:0,profitFloorPct:null,nextTakeProfitPct:8}
      : {action:"진입",tone:"good",newEntryAllowed:true,runnerAllowed:true,averageDownAllowed:false,reason:"정식 ENTRY 승인",gain:0,scoreDrop:0,repeatCount:1,mfe:0,peakPrice:num(row.krw_price),giveback:0,profitFloorPct:null,nextTakeProfitPct:8};
    output.push(base.formatCandidate(row,output.length+1,{signal,...state,status:kind==="EARLY15"?"15분 선발대 · 초기진입":"진입 · 최초승인"}));
  }

  const priority={"러너청산":0,"수익보호":1,"2차익절":2,"1차익절":3,"매도준비":4,"물타기금지":5,"진입":6,"진입유지":7,"러너유지":8,"단타보유":9,"보유점검":10};
  return output.sort((a,b)=>(priority[a.action]??99)-(priority[b.action]??99)||Number(b.score)-Number(a.score)).slice(0,10).map((r,i)=>({...r,rank:i+1}));
}

base.createLatestPrePumpHandler=function({db}){
  return async function(_req,res){
    try{
      const rows=await loadCompat(db);
      res.setHeader("Cache-Control","no-store");
      return res.json(rows);
    }catch(error){
      return res.status(503).json({error:"TOP3_MAINTENANCE",message:String(error?.message||error)});
    }
  };
};

module.exports=base;
