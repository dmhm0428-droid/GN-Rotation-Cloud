"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {selectLeadingTop3,stageOf}=require("../src/leading-top3-policy");

function row(market,rank,overrides={}){
  return {market,rank,mechanicalScore:85,maAlignment:75,ma20Slope:.25,obv1h:.25,volumeAccel5m:2,repeatCount:2,riseSinceFirstPct:1,candidateAgeMin:1,preExpansionEligible:true,return60m:.01,extensionFromLow2h:.02,globalSpotExchangeCount:2,globalExchangeSync:1,empiricalValidation:{lead_core:true,lagging:false},...overrides};
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
