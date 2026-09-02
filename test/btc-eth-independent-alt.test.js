"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {annotateBtcEthIndependence,enforceSingleIntradayEntry}=require("../src/pre-pump-scanner");

function benchmarks(){
  return [
    {market:"KRW-BTC",return5m:-.004,return15m:-.008,return60m:-.018,turnoverGrowth15m:.1,obvDirection:-.1,higherLow15m:false,structure1h:"downtrend"},
    {market:"KRW-ETH",return5m:-.005,return15m:-.010,return60m:-.022,turnoverGrowth15m:.1,obvDirection:-.1,higherLow15m:false,structure1h:"downtrend"}
  ];
}

test("classifies an alt with its own flow as BTC/ETH independent while benchmarks fall",()=>{
  const rows=annotateBtcEthIndependence([
    ...benchmarks(),
    {market:"KRW-ALT",return5m:.008,return15m:.018,return60m:.035,turnoverGrowth15m:1.2,obvDirection:.7,higherLow15m:true,structure1h:"sideways_breakout"}
  ]);
  const alt=rows.find(x=>x.market==="KRW-ALT");
  assert.equal(alt.btcEthIndependent,true);
  assert.equal(alt.dependencyClass,"BTC_ETH_INDEPENDENT");
  assert.equal(alt.sameDayReady,true);
  assert.ok(alt.relative15mVsBtc>0);
  assert.ok(alt.relative15mVsEth>0);
});

test("rejects an alt that merely follows BTC/ETH",()=>{
  const rows=annotateBtcEthIndependence([
    ...benchmarks(),
    {market:"KRW-BETA",return5m:-.003,return15m:-.007,return60m:-.016,turnoverGrowth15m:.4,obvDirection:.2,higherLow15m:true,structure1h:"neutral"}
  ]);
  const alt=rows.find(x=>x.market==="KRW-BETA");
  assert.equal(alt.btcEthIndependent,false);
  assert.equal(alt.dependencyClass,"BTC_ETH_DEPENDENT");
  assert.equal(alt.sameDayReady,false);
});

test("fails closed when either BTC or ETH benchmark is unavailable",()=>{
  const rows=annotateBtcEthIndependence([
    benchmarks()[0],
    {market:"KRW-ALT",return5m:.02,return15m:.03,return60m:.05,turnoverGrowth15m:2,obvDirection:1,higherLow15m:true,structure1h:"sideways_breakout"}
  ]);
  const alt=rows.find(x=>x.market==="KRW-ALT");
  assert.equal(alt.benchmarkAvailable,false);
  assert.equal(alt.btcEthIndependent,false);
  assert.equal(alt.dependencyClass,"BENCHMARK_UNKNOWN");
});

test("allows at most one actual same-day ENTRY",()=>{
  const rows=enforceSingleIntradayEntry([
    {market:"KRW-A",state:"ENTRY",btcEthIndependent:true,sameDayReady:true,highChaseRisk:false,latePumpRisk:false},
    {market:"KRW-B",state:"ENTRY",btcEthIndependent:true,sameDayReady:true,highChaseRisk:false,latePumpRisk:false},
    {market:"KRW-C",state:"SCOUT",btcEthIndependent:true,sameDayReady:true}
  ]);
  assert.equal(rows.filter(x=>x.state==="ENTRY").length,1);
  assert.equal(rows.filter(x=>x.entrySlot===1).length,1);
  assert.ok(rows.every(x=>x.sameDayExitRequired===true));
  assert.ok(rows.every(x=>x.holdingHorizon==="INTRADAY_1D"));
});
