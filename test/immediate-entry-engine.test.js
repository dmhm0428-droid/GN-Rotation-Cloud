"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {assessImmediateEntry,snapshotRow,timeFlowFor}=require("../src/immediate-entry-runner");

function goodRow(overrides={}){
  return {market:"KRW-TEST",state:"ENTRY",score:85,krwPrice:100,obvDirection:.25,turnoverGrowth15m:.8,return15m:.02,return60m:.025,extensionFromLow2h:.035,preExpansionEligible:true,structure1h:"uptrend",htfEntryBlocked:false,dailyIgnitionScore:80,accumulationPersistenceScore:80,latePumpRisk:false,distributionRisk:false,heavyOldSellWall:false,individualRiskBlocked:false,orderbookAvailable:true,orderbookSignal:"SELL_ABSORPTION",orderbookEntryBlocked:false,orderbookBestBid:99.9,orderbookBestAsk:100.1,globalSpotOk:true,globalSpotExchangeCount:2,globalExchangeSync:1,derivativeDataAvailable:true,derivativeScore:70,...overrides};
}
function goodPersistence(overrides={}){
  return {repeatCount:3,firstDetectedAt:"2026-09-01T00:00:00Z",firstDetectedPrice:99,timeFlowAvailable:true,timeFlowScore:82,timeFlowTrend:.65,timeFlowPositiveSteps:3,timeFlowSeries:[{ratio:1.05},{ratio:1.22},{ratio:1.45},{ratio:1.7}],...overrides};
}

test("immediate entry requires every hard gate including measured time flow",()=>{
  const out=assessImmediateEntry(goodRow(),goodPersistence());
  assert.equal(out.entryAllowed,true);
  assert.ok(out.probabilityScore>=78);
  assert.equal(out.entryPlan.valid,true);
});

test("single detection is not recommended",()=>{
  const out=assessImmediateEntry(goodRow(),goodPersistence({repeatCount:1}));
  assert.equal(out.entryAllowed,false);
  assert.ok(out.entryReasons.includes("repeat"));
});

test("missing time-flow history blocks recommendation rather than inventing probability",()=>{
  const out=assessImmediateEntry(goodRow(),{repeatCount:3,timeFlowAvailable:false,timeFlowScore:null});
  assert.equal(out.entryAllowed,false);
  assert.equal(out.probabilityScore,null);
  assert.ok(out.entryReasons.includes("timeFlow"));
  assert.ok(out.entryReasons.includes("probability"));
});

test("unverified global spot blocks recommendation",()=>{
  const out=assessImmediateEntry(goodRow({globalSpotOk:false}),goodPersistence());
  assert.equal(out.entryAllowed,false);
  assert.ok(out.entryReasons.includes("globalSpot"));
});

test("pre-expansion watch candidates are persisted without being mislabeled ENTRY",()=>{
  const assessed=assessImmediateEntry(goodRow({globalSpotOk:false}),goodPersistence());
  const stored=snapshotRow(assessed,"run-1","2026-09-01T00:01:00Z",1);
  assert.equal(stored.status,"WATCH");
  assert.equal(stored.details.entry_allowed,false);
  assert.equal(stored.details.top3_role,"PRE_EXPANSION_WATCH");
  assert.equal(stored.details.lead_lag.time_flow_score,82);
});

test("two-hour extension blocks entry even when all other gates pass",()=>{
  const out=assessImmediateEntry(goodRow({preExpansionEligible:false,return60m:.05,extensionFromLow2h:.07}),goodPersistence());
  assert.equal(out.entryAllowed,false);
  assert.ok(out.entryReasons.includes("preExpansion"));
});

test("timeFlowFor scores rising repeated turnover observations higher than fading flow",()=>{
  const runs=[
    {started_at:"2026-09-01T00:00:00Z",source_status:{watchlist:[{market:"KRW-TEST",turnoverGrowth15m:.05}]}},
    {started_at:"2026-09-01T00:15:00Z",source_status:{watchlist:[{market:"KRW-TEST",turnoverGrowth15m:.20}]}},
    {started_at:"2026-09-01T00:30:00Z",source_status:{watchlist:[{market:"KRW-TEST",turnoverGrowth15m:.40}]}}
  ];
  const rising=timeFlowFor(goodRow({turnoverGrowth15m:.70}),runs);
  const fading=timeFlowFor(goodRow({turnoverGrowth15m:.02}),runs);
  assert.equal(rising.timeFlowAvailable,true);
  assert.ok(rising.timeFlowScore>fading.timeFlowScore);
  assert.ok(rising.timeFlowScore>=60);
});
