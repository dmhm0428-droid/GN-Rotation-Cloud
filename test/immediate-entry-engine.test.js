"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {assessImmediateEntry,snapshotRow}=require("../src/immediate-entry-runner");

function goodRow(overrides={}){
  return {market:"KRW-TEST",state:"ENTRY",score:85,krwPrice:100,obvDirection:.25,turnoverGrowth15m:.8,return15m:.02,return60m:.025,extensionFromLow2h:.035,preExpansionEligible:true,structure1h:"uptrend",htfEntryBlocked:false,dailyIgnitionScore:80,accumulationPersistenceScore:80,latePumpRisk:false,distributionRisk:false,heavyOldSellWall:false,individualRiskBlocked:false,orderbookAvailable:true,orderbookSignal:"SELL_ABSORPTION",orderbookEntryBlocked:false,orderbookBestBid:99.9,orderbookBestAsk:100.1,globalSpotOk:true,globalSpotExchangeCount:2,globalExchangeSync:1,derivativeDataAvailable:true,derivativeScore:70,...overrides};
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

test("pre-expansion watch candidates are persisted without being mislabeled ENTRY",()=>{
  const assessed=assessImmediateEntry(goodRow({globalSpotOk:false}),{repeatCount:2,firstDetectedAt:"2026-09-01T00:00:00Z",firstDetectedPrice:99});
  const stored=snapshotRow(assessed,"run-1","2026-09-01T00:01:00Z",1);
  assert.equal(stored.status,"WATCH");
  assert.equal(stored.details.entry_allowed,false);
  assert.equal(stored.details.top3_role,"PRE_EXPANSION_WATCH");
});

test("two-hour extension blocks entry even when all old gates pass",()=>{
  const out=assessImmediateEntry(goodRow({preExpansionEligible:false,return60m:.05,extensionFromLow2h:.07}),{repeatCount:3});
  assert.equal(out.entryAllowed,false);
  assert.ok(out.entryReasons.includes("preExpansion"));
});
