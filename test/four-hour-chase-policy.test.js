"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {analyzeSeries,combineFourHourChecks}=require("../src/four-hour-chase-policy");

function upbitSeries({currentOpen=100,currentClose=100.5,priorClose=100,priorHigh=110}={}){
  const chronological=[];
  for(let i=0;i<29;i++)chronological.push({opening_price:priorClose,high_price:priorHigh,low_price:priorClose*.98,trade_price:priorClose});
  chronological.push({opening_price:currentOpen,high_price:Math.max(currentOpen,currentClose)*1.002,low_price:Math.min(currentOpen,currentClose)*.995,trade_price:currentClose});
  return chronological.reverse();
}

test("4H extended candle at the top is blocked as NO_CHASE",()=>{
  const out=analyzeSeries(upbitSeries({currentOpen:100,currentClose:106,priorClose:100,priorHigh:106.5}),{kind:"upbit"});
  assert.equal(out.available,true);
  assert.equal(out.blockTop3,true);
  assert.ok(out.candleReturnPct>=3);
  assert.ok(out.reasons.some(x=>x.includes("현재 4H 봉")));
});

test("4H candidate with headroom and low stretch remains eligible",()=>{
  const out=analyzeSeries(upbitSeries({currentOpen:100,currentClose:100.5,priorClose:100,priorHigh:110}),{kind:"upbit"});
  assert.equal(out.available,true);
  assert.equal(out.blockTop3,false);
  assert.ok(out.swingHighDistancePct<-1);
});

test("cross-venue disagreement is WATCH, confirmed risk is blocked",()=>{
  const risky={available:true,blockTop3:true,extreme:false,reasons:["risk"]};
  const clear={available:true,blockTop3:false,extreme:false,reasons:[]};
  const watch=combineFourHourChecks([risky,clear]);
  assert.equal(watch.blockTop3,false);
  assert.equal(watch.status,"WATCH");
  const blocked=combineFourHourChecks([risky,{...risky,source:"binance"}]);
  assert.equal(blocked.blockTop3,true);
  assert.equal(blocked.status,"NO_CHASE");
});

test("missing 4H data never preserves ENTRY permission",()=>{
  const out=combineFourHourChecks([{available:false},{available:false}]);
  assert.equal(out.available,false);
  assert.equal(out.entryBlocked,true);
  assert.equal(out.status,"UNVERIFIED");
});
