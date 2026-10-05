"use strict";
// Display eligibility from explicit, dated evidence. Scores or news never stand in for missing gates.
function createFrameworkPolicy(){
 const STAGES=[['money_rate_cause','돈의 방향·금리 원인'],['inflation_regime','인플레이션 국면'],['market_breadth','시장 폭'],['company_quality','기업 질 5대 관문'],['leadership_price','상대강도·차트·선반영'],['execution','매수·회수 조건']];
 const QUALITY=[['estimates','실적추정치'],['cashflow','영업현금흐름'],['valuation','밸류에이션'],['pricing_power','가격전가력'],['roic_wacc','ROIC·WACC']];
 const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
 function proof(p,now){
  if(!p||p.verified!==true||!Array.isArray(p.sources)||!p.sources.some(s=>typeof s==='string'&&s.trim()))return 'UNKNOWN';
  const at=Date.parse(p.observed_at),until=Date.parse(p.valid_until);
  if(!Number.isFinite(at)||!Number.isFinite(until)||at>now||until<now)return 'UNKNOWN';
  return ['PASS','FAIL'].includes(p.status)?p.status:'UNKNOWN';
 }
 function assess(row,now=Date.now()){
  const data=row?.components?.gn_framework||{};const crypto=row?.kind==='crypto';
  const gates=STAGES.map(([key,label])=>{const p=data[key];let status=proof(p,now),children=[];
   if(key==='company_quality'&&!crypto){children=QUALITY.map(([k,l])=>({label:l,status:proof(p?.checks?.[k],now),evidence:p?.checks?.[k]}));status=children.some(x=>x.status==='FAIL')?'FAIL':children.every(x=>x.status==='PASS')?'PASS':'UNKNOWN';}
   if(key==='company_quality'&&crypto){label='크립토 현물·파생·유동성';status=proof(data.crypto_quality,now);return {key,label,status,evidence:data.crypto_quality,children};}
   return {key,label,status,evidence:p,children};});
  const failed=gates.filter(x=>x.status==='FAIL'),missing=gates.filter(x=>x.status==='UNKNOWN');
  const priceKnown=finite(row?.price)&&Number(row.price)>0;
  const execution=data.execution;const planValid=finite(execution?.buy_krw)&&Number(execution.buy_krw)>0&&finite(execution?.invalidation_krw)&&Number(execution.invalidation_krw)>0&&finite(execution?.recovery_krw)&&Number(execution.recovery_krw)>0&&typeof execution?.review_at==='string'&&Number.isFinite(Date.parse(execution.review_at));
  const eligible=!failed.length&&!missing.length&&priceKnown&&planValid;
  return {gates,eligible,state:failed.length?'미통과':eligible?'조건 충족':'검증 보류',action:failed.length?'진입 보류':eligible?(execution.action||'조건 확인 완료'):'판정 보류',missing:missing.map(x=>x.label),failed:failed.map(x=>x.label),plan:eligible?execution:null};
 }
 function krwQuote(price,currency,fx,now=Date.now()){
  if(!finite(price)||Number(price)<=0)return null;if(currency==='KRW')return Number(price);
  const ts=Date.parse(fx?.tradedAt);if(currency!=='USD'||!finite(fx?.price)||Number(fx.price)<=0||!Number.isFinite(ts)||ts>now||now-ts>24*3600000)return null;
  return Number(price)*Number(fx.price);
 }
 return {STAGES,QUALITY,finite,proof,assess,krwQuote};
}
module.exports={createFrameworkPolicy};
