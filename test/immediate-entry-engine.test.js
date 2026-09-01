"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {assessImmediateEntry}=require("../src/immediate-entry-runner");

function goodRow(overrides={}){
  return {market:"KRW-TEST",state:"ENTRY",score:85,krwPrice:100,obvDirection:.25,turnoverGrowth15m:.8,return15m:.02,structure1h:"uptrend",htfEntryBlocked:false,dailyIgnitionScore:80,accumulationPersistenceScore:80,latePumpRisk:false,distributionRisk:false,heavyOldSellWall:false,individualRiskBlocked:false,orderbookAvailable:true,orderbookSignal:"SELL_ABSORPTION",orderbookEntryBlocked:false,orderbookBestBid:99.9,orderbookBestAsk:100.1,globalSpotOk:true,derivativeDataAvailable:true,derivativeScore:70,...overrides};
}

test("immediate entry requires every hard gate",()=>{
  const out=assessImmediateEntry(goodRow(),{repeatCount:2,firstDetectedAt:"2026-09-01T00:00:00Z",firstDetectedPrice:99});
  assert.equal(out.entryAllowed,true);
  assert.ok(out.probabilityScore>=78);
  assert.equal(out.entryPlan.valid,true);
});

test("single detection is not recommended",()=>{
  const out=assessImmediateEntry(goodRow(),{repeatCount:1});
  assert.equal(out.entryAllowed,false);
  assert.ok(out.entryReasons.includes("repeat"));
});

test("unverified global spot blocks recommendation",()=>{
  const out=assessImmediateEntry(goodRow({globalSpotOk:false}),{repeatCount:3});
  assert.equal(out.entryAllowed,false);
  assert.ok(out.entryReasons.includes("globalSpot"));
});
