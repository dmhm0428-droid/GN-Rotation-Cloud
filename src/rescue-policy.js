"use strict";

// GN Rescue / Sell Discipline policy engine.
// Pure policy only: it never sends orders. Execution must be handled by a
// separate worker and should default to PAPER mode.

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};

const DEFAULT_POLICY={
  // Profit-taking ladder. Fractions are of original position size.
  takeProfit:[
    {id:"TP1",profitPct:5,sellFraction:.20},
    {id:"TP2",profitPct:10,sellFraction:.25},
    {id:"TP3",profitPct:15,sellFraction:.25}
  ],
  // Remaining 30% is trend/core inventory unless a validated exit fires.
  coreFraction:.30,

  // A single price break is NOT enough for a stop. Require persistence plus
  // market/flow confirmation to reduce panic-selling near intraday lows.
  stopValidation:{
    minBreakMinutes:60,
    minConfirmations:2,
    confirmations:["market_risk_off","flow_out","higher_tf_break","volume_distribution"]
  },

  // Legacy Upbit alt inventory is sell-locked unless an exception applies.
  // BTC and ETH are intentionally NOT locked. Keep the list configurable
  // through GN_TAX_LOCK_SYMBOLS.
  taxLockSymbols:["SHIB","LINK","ETC","WLD","ONDO","LSK","ADA","SOPH","SAND"],
  taxLockDefault:true,
  taxLockExceptions:["delisting","forced_liquidation","custody_risk","user_override"],

  // Rescue proceeds are cash, not fresh risk capital.
  blockReinvestment:true
};

function envTaxLockSymbols(){
  const raw=String(process.env.GN_TAX_LOCK_SYMBOLS||"").trim();
  if(!raw)return null;
  return raw.split(",").map(x=>x.trim().toUpperCase()).filter(Boolean);
}

function policyWithEnv(policy={}){
  const p={...DEFAULT_POLICY,...policy};
  const envSymbols=envTaxLockSymbols();
  if(envSymbols)p.taxLockSymbols=envSymbols;
  return p;
}

function normalizedSymbol(position){
  return String(position?.symbol||position?.coin||position?.market||"")
    .toUpperCase().replace(/^KRW-/,'').replace(/^USDT-/,'');
}

function profitPct(position){
  const explicit=num(position?.profitPct??position?.returnPct);
  if(explicit!=null)return explicit;
  const price=num(position?.price??position?.currentPrice);
  const avg=num(position?.avgPrice??position?.averagePrice);
  return price!=null&&avg>0?(price/avg-1)*100:null;
}

function soldFraction(state){
  const done=new Set((state?.completedStages||[]).map(String));
  return DEFAULT_POLICY.takeProfit
    .filter(x=>done.has(x.id))
    .reduce((s,x)=>s+x.sellFraction,0);
}

function taxLockDecision(position,context,policy){
  const symbol=normalizedSymbol(position);
  const configured=new Set((policy.taxLockSymbols||[]).map(x=>String(x).toUpperCase()));
  const explicitlyLocked=position?.taxLock===true||position?.tax_loss_lock===true;
  const locked=explicitlyLocked||(policy.taxLockDefault&&configured.has(symbol));
  if(!locked)return {locked:false,symbol};

  const exception=String(context?.exception||position?.exception||"").toLowerCase();
  const allowed=new Set((policy.taxLockExceptions||[]).map(String));
  if(exception&&allowed.has(exception))return {locked:false,symbol,exception,override:true};
  return {locked:true,symbol,reason:"TAX_LOSS_INVENTORY_LOCK"};
}

function nextTakeProfit(position,state,policy){
  const p=profitPct(position);
  if(p==null)return null;
  const done=new Set((state?.completedStages||[]).map(String));
  for(const stage of policy.takeProfit||[]){
    if(done.has(stage.id))continue;
    if(p>=stage.profitPct){
      return {
        type:"SELL_PARTIAL",
        stage:stage.id,
        sellFraction:stage.sellFraction,
        reason:`수익 ${p.toFixed(2)}% · ${stage.id} 자동회수`,
        blockReinvestment:policy.blockReinvestment===true
      };
    }
  }
  return null;
}

function validatedStop(position,context,policy){
  const broken=context?.supportBroken===true||context?.invalidated===true;
  if(!broken)return null;

  const minutes=num(context?.breakMinutes)??0;
  if(minutes<(policy.stopValidation?.minBreakMinutes??60)){
    return {type:"HOLD",reason:`지지 이탈 ${minutes}분 · 시간 검증 대기`};
  }

  const keys=policy.stopValidation?.confirmations||[];
  const confirmations=keys.filter(k=>context?.[k]===true);
  const needed=policy.stopValidation?.minConfirmations??2;
  if(confirmations.length<needed){
    return {type:"HOLD",reason:`지지 이탈 지속 · 위험확인 ${confirmations.length}/${needed}`};
  }

  const severity=clamp(confirmations.length/Math.max(needed,keys.length),0,1);
  const sellFraction=severity>=.75?.50:.25;
  return {
    type:"SELL_PARTIAL",
    stage:"VALIDATED_STOP",
    sellFraction,
    reason:`지지 이탈 + ${confirmations.join("+")} 확인 · 단계축소`,
    confirmations
  };
}

function evaluateRescue(position,state={},context={},customPolicy={}){
  const policy=policyWithEnv(customPolicy);
  const lock=taxLockDecision(position,context,policy);

  // Delisting/forced-disposal exceptions outrank the legacy tax-loss lock.
  if(lock.override){
    return {
      type:"SELL_EXIT",
      sellFraction:1,
      reason:`세금보전 잠금 예외 · ${lock.exception}`,
      symbol:lock.symbol,
      blockReinvestment:true
    };
  }

  // Preserve legacy deeply impaired inventory for tax-policy use; do not let
  // routine stop-loss or profit logic liquidate it accidentally.
  if(lock.locked){
    return {type:"LOCKED",reason:lock.reason,symbol:lock.symbol};
  }

  const tp=nextTakeProfit(position,state,policy);
  if(tp)return {...tp,symbol:lock.symbol};

  const stop=validatedStop(position,context,policy);
  if(stop)return {...stop,symbol:lock.symbol};

  return {type:"HOLD",reason:"회수/손절 조건 미충족",symbol:lock.symbol};
}

module.exports={DEFAULT_POLICY,evaluateRescue,policyWithEnv,profitPct,taxLockDecision,validatedStop,nextTakeProfit};
