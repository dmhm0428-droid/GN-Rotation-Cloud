"use strict";

process.env.GN_TOP3_LIVE_ENABLED="true";
const test=require("node:test");
const assert=require("node:assert/strict");
const {continuityState,hardValidated,signalApproved}=require("../src/pre-pump-dashboard");

function approved(overrides={}){
  const now=new Date().toISOString();
  return {
    rank:1,market:"KRW-AAA",score:80,status:"ENTRY",krw_price:100,
    recommended_entry_krw:100,recommended_entry_low:98,recommended_entry_high:102,ts:now,
    details:{
      entry_allowed:true,five_ai_gate_ok:true,quality_ok:true,entry_sanity_ok:true,
      global_spot_ok:true,multi_exchange_ok:true,onchain_ok:true,derivatives_ok:true,
      multi_timeframe_ok:true,cumulative_flow_ok:true,support_resistance_ok:true,
      risk_reward_ok:true,market_block:false,no_chase:false
    },
    ...overrides
  };
}

test("first ENTRY remains strict and fail-closed",()=>{
  assert.equal(hardValidated(approved()),true);
  assert.equal(hardValidated(approved({score:74})),false);
  assert.equal(hardValidated(approved({krw_price:104})),false);
  const bad=approved();bad.details={...bad.details,onchain_ok:false};
  assert.equal(hardValidated(bad),false);
});

test("historical approved signal can be tracked after the 20 minute entry window",()=>{
  const old=approved({ts:new Date(Date.now()-60*60*1000).toISOString()});
  assert.equal(hardValidated(old),false);
  assert.equal(signalApproved(old,{checkAge:false}),true);
});

test("approved signal repeats as entry-maintain while price stays in band",()=>{
  const signal=approved();
  const current={...signal,score:78,krw_price:101,ts:new Date().toISOString()};
  const state=continuityState({signal,current,market:{score:61,delta:4},repeatCount:3});
  assert.equal(state.action,"진입유지");
  assert.equal(state.newEntryAllowed,true);
  assert.equal(state.repeatCount,3);
});

test("breakout does not disappear; it becomes breakout-hold and blocks fresh chasing",()=>{
  const signal=approved();
  const current={...signal,score:79,status:"SCOUT",krw_price:108,ts:new Date().toISOString()};
  const state=continuityState({signal,current,market:{score:66,delta:5},repeatCount:4});
  assert.equal(state.action,"돌파보유");
  assert.equal(state.newEntryAllowed,false);
});

test("NO_CHASE after an approved entry becomes sell-preparation, not silent disappearance",()=>{
  const signal=approved();
  const current={...signal,status:"NO_CHASE",krw_price:110,ts:new Date().toISOString()};
  const state=continuityState({signal,current,market:{score:64,delta:2},repeatCount:5});
  assert.equal(state.action,"매도준비");
  assert.equal(state.newEntryAllowed,false);
});

test("market or score deterioration keeps the position visible as holding-review",()=>{
  const signal=approved();
  const current={...signal,score:66,krw_price:100,ts:new Date().toISOString()};
  const state=continuityState({signal,current,market:{score:43,delta:-11},repeatCount:4});
  assert.equal(state.action,"보유점검");
});
