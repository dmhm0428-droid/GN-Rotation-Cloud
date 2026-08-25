"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {evaluateRescue}=require("../src/rescue-policy");

test("takes 20% at +5%",()=>{
  const r=evaluateRescue({symbol:"ETH",profitPct:5.2},{completedStages:[]},{});
  assert.equal(r.type,"SELL_PARTIAL");
  assert.equal(r.stage,"TP1");
  assert.equal(r.sellFraction,.20);
});

test("advances to TP2 after TP1 completed",()=>{
  const r=evaluateRescue({symbol:"BTC",profitPct:11},{completedStages:["TP1"]},{});
  assert.equal(r.stage,"TP2");
  assert.equal(r.sellFraction,.25);
});

test("does not panic sell on a fresh support break",()=>{
  const r=evaluateRescue({symbol:"IREN",profitPct:-6},{},{supportBroken:true,breakMinutes:15,market_risk_off:true,flow_out:true});
  assert.equal(r.type,"HOLD");
});

test("validated stop needs persistence and at least two confirmations",()=>{
  const r=evaluateRescue({symbol:"IREN",profitPct:-6},{},{supportBroken:true,breakMinutes:90,market_risk_off:true,flow_out:true});
  assert.equal(r.type,"SELL_PARTIAL");
  assert.equal(r.sellFraction,.25);
});

test("legacy tax-loss inventory remains locked",()=>{
  const r=evaluateRescue({symbol:"LSK",profitPct:-98},{},{supportBroken:true,breakMinutes:999,market_risk_off:true,flow_out:true,higher_tf_break:true});
  assert.equal(r.type,"LOCKED");
});

test("delisting exception overrides tax-loss lock",()=>{
  const r=evaluateRescue({symbol:"SAND",profitPct:-90},{},{exception:"delisting"});
  assert.equal(r.type,"SELL_EXIT");
  assert.equal(r.sellFraction,1);
});
