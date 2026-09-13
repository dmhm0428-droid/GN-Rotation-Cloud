"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {selectLeadingTop3,stageOf,timeFlowSignal,empiricalProbability}=require("../src/leading-top3-policy");

function flow(values=[1.05,1.12,1.25,1.45,1.75]){
  return [120,60,30,15,0].map((offsetMin,index)=>({offsetMin,ratio:values[index]}));
}
function row(market,rank,overrides={}){
  return {market,rank,mechanicalScore:85,maAlignment:75,ma20Slope:.25,obv1h:.25,volumeAccel5m:2,repeatCount:2,riseSinceFirstPct:1,candidateAgeMin:1,preExpansionEligible:true,return60m:.01,extensionFromLow2h:.02,globalSpotExchangeCount:2,globalExchangeSync:1,volumeTimeSeries:flow(),empiricalValidation:{lead_core:true,lagging:false},...overrides};
}

test("TOP3 only uses repeated, globally confirmed pre-expansion candidates",()=>{
  const rows=[
    row("KRW-A",1,{empiricalValidation:{lead_core:false,lagging:true},ma20Slope:-.1}),
    row("KRW-B",2,{empiricalValidation:{lead_core:false,lagging:true},obv1h:-.1}),
    row("KRW-C",3,{empiricalValidation:{lead_core:false,lagging:true},maAlignment:35}),
    row("KRW-D",4,{empiricalValidation:{lead_core:true,lagging:false},maAlignment:70,ma20Slope:.2,obv1h:.2,repeatCount:2}),
    row("KRW-E",5,{repeatCount:2,mechanicalScore:82}),
    row("KRW-F",6,{recommendationEligible:true,repeatCount:2})
  ];
  const out=selectLeadingTop3(rows);
  assert.deepEqual(out.top3.map(x=>x.market),["KRW-F","KRW-E","KRW-D"]);
  assert.equal(out.top3.length,3);
});

test("ENTRY is an upgrade after the same pre-expansion gate",()=>{
  const out=selectLeadingTop3([row("KRW-SCOUT",4),row("KRW-ENTRY",8,{strictImmediate:true,entryAllowed:true})]);
  assert.equal(out.top3[0].market,"KRW-ENTRY");
  assert.equal(stageOf(out.top3[0]),"ENTRY");
  assert.equal(out.top3.some(x=>x.market==="KRW-SCOUT"),true);
});

test("hard lagging/overheated rows do not enter TOP3 and remain explainable near-miss",()=>{
  const out=selectLeadingTop3([row("KRW-HOT",1,{volumeAccel5m:12}),row("KRW-OK",4)]);
  assert.equal(out.top3[0].market,"KRW-OK");
  const hot=out.nearMiss.find(x=>x.market==="KRW-HOT");
  assert.ok(hot);
  assert.equal(hot.isLagging,true);
  assert.ok(hot.lagReasons.some(x=>x.includes("과열")));
});

test("a candidate that has not reappeared for over 20 minutes cannot occupy TOP3",()=>{
  const out=selectLeadingTop3([
    row("KRW-OLD",1,{candidateAgeMin:24,mechanicalScore:99,repeatCount:4,maAlignment:100,ma20Slope:.8,obv1h:.8}),
    row("KRW-NOW",2,{candidateAgeMin:2,maAlignment:70,ma20Slope:.2,obv1h:.2})
  ]);
  assert.equal(out.top3[0].market,"KRW-NOW");
  assert.equal(out.top3.some(x=>x.market==="KRW-OLD"),false);
  const old=out.nearMiss.find(x=>x.market==="KRW-OLD");
  assert.ok(old);
  assert.ok(old.lagReasons.some(x=>x.includes("20분")));
});

test("a locally strong candidate without two synchronized overseas spot venues is excluded",()=>{
  const out=selectLeadingTop3([
    row("KRW-LOCAL",1,{mechanicalScore:99,globalSpotExchangeCount:1,globalExchangeSync:.5}),
    row("KRW-GLOBAL",2)
  ]);
  assert.deepEqual(out.top3.map(x=>x.market),["KRW-GLOBAL"]);
});

test("a candidate already four percent above the last hour is discarded",()=>{
  const out=selectLeadingTop3([row("KRW-LATE",1,{return60m:.041,preExpansionEligible:false}),row("KRW-EARLY",2)]);
  assert.deepEqual(out.top3.map(x=>x.market),["KRW-EARLY"]);
  assert.ok(out.discarded[0].discardReasons.some(x=>x.includes("확장")||x.includes("60분")));
});

test("TOP3 requires measurable rising turnover across time, not a single hot snapshot",()=>{
  const rising=row("KRW-RISING",1,{volumeTimeSeries:flow([1.02,1.08,1.20,1.42,1.80])});
  const fading=row("KRW-FADING",2,{mechanicalScore:99,volumeTimeSeries:flow([2.4,2.1,1.8,1.45,1.20])});
  const out=selectLeadingTop3([fading,rising]);
  assert.deepEqual(out.top3.map(x=>x.market),["KRW-RISING"]);
  assert.ok(timeFlowSignal(rising).score>=60);
  assert.ok(timeFlowSignal(fading).score<60);
});

test("missing T-120 to current turnover history is not allowed into TOP3",()=>{
  const out=selectLeadingTop3([row("KRW-NO-HISTORY",1,{volumeTimeSeries:[]}),row("KRW-WITH-HISTORY",2)]);
  assert.deepEqual(out.top3.map(x=>x.market),["KRW-WITH-HISTORY"]);
  const miss=out.nearMiss.find(x=>x.market==="KRW-NO-HISTORY");
  assert.ok(miss.lagReasons.some(x=>x.includes("시계열")));
});

test("probability is only marked verified when backed by an explicit empirical hit rate and adequate sample",()=>{
  const none=empiricalProbability(row("KRW-NONE",1));
  assert.equal(none.available,false);
  const small=empiricalProbability(row("KRW-SMALL",1,{empiricalHitRate24h:.72,empiricalSampleSize:12}));
  assert.equal(small.rate,72);
  assert.equal(small.verified,false);
  const verified=empiricalProbability(row("KRW-VERIFIED",1,{empiricalHitRate24h:68,empiricalSampleSize:45}));
  assert.equal(verified.rate,68);
  assert.equal(verified.verified,true);
});
