"use strict";
// GN additive crypto/liquidity footprint definitions. No existing gates are changed.
const INDICATORS = Object.freeze([
  {id:"fed_assets",series:"WALCL",source:"FRED/Federal Reserve",unit:"USD millions",maxAgeHours:240},
  {id:"tga",series:"WTREGEN",source:"FRED/US Treasury",unit:"USD millions",maxAgeHours:240},
  {id:"rrp",series:"RRPONTSYD",source:"FRED/New York Fed",unit:"USD billions",maxAgeHours:48},
  {id:"bank_reserves",series:"WRESBAL",source:"FRED/Federal Reserve",unit:"USD millions",maxAgeHours:240},
  {id:"global_m2",series:"GLOBAL_M2",source:"MacroMicro (secondary)",unit:"source dependent",maxAgeHours:1080},
  {id:"btc_cme_basis",series:"BTC_CME_ANNUALIZED_BASIS",source:"CryptoQuant",unit:"percent",maxAgeHours:6},
  {id:"btc_basis_crosscheck",series:"BTC_BASIS",source:"Coinglass",unit:"percent",maxAgeHours:6},
  {id:"iorb",series:"IORB",source:"FRED/Federal Reserve",unit:"percent",maxAgeHours:72},
  {id:"sofr",series:"SOFR",source:"FRED/NY Fed",unit:"percent",maxAgeHours:72},
  {id:"effr",series:"EFFR",source:"FRED/NY Fed",unit:"percent",maxAgeHours:72}
]);
function validate(observation,now=Date.now()){
  const spec=INDICATORS.find(x=>x.id===observation?.id);
  if(!spec)return {status:"UNVERIFIED",reason:"unknown_indicator"};
  const t=Date.parse(observation?.observed_at);
  if(!Number.isFinite(t)||t>now+300000)return {status:"UNVERIFIED",reason:"missing_or_future_timestamp"};
  if(!Number.isFinite(observation?.value))return {status:"UNVERIFIED",reason:"missing_value"};
  if(!observation?.source)return {status:"UNVERIFIED",reason:"missing_source"};
  if(now-t>spec.maxAgeHours*3600000)return {status:"STALE",reason:"source_age_exceeded"};
  return {status:"OBSERVED",reason:"requires_cross_source_confirmation_before_PASS"};
}
// WALCL and WTREGEN are USD millions; RRPONTSYD is USD billions.
// WRESBAL is bank reserves, NOT reverse repos. Never subtract WRESBAL as RRP.
function netLiquidityUsdMillions({walcl,wtregen,rrp}){
  if(![walcl,wtregen,rrp].every(Number.isFinite))return null;
  return walcl-wtregen-rrp*1000;
}
function fundingSpreadBps({sofr,iorb}){
  return [sofr,iorb].every(Number.isFinite)?(sofr-iorb)*100:null;
}
module.exports={INDICATORS,validate,netLiquidityUsdMillions,fundingSpreadBps};
