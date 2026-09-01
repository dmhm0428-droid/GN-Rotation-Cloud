"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {selectLeadingTop3,stageOf}=require("../src/leading-top3-policy");

function row(market,rank,overrides={}){
  return {market,rank,mechanicalScore:60,maAlignment:55,ma20Slope:.05,obv1h:.08,volumeAccel5m:2,repeatCount:1,riseSinceFirstPct:1,empiricalValidation:{lead_core:false,lagging:false},...overrides};
}

test("TOP3 uses broader non-lagging precursors instead of requiring ENTRY",()=>{
  const rows=[
    row("KRW-A",1,{empiricalValidation:{lead_core:false,lagging:true},ma20Slope:-.1}),
    row("KRW-B",2,{empiricalValidation:{lead_core:false,lagging:true},obv1h:-.1}),
    row("KRW-C",3,{empiricalValidation:{lead_core:false,lagging:true},maAlignment:35}),
    row("KRW-D",4,{empiricalValidation:{lead_core:true,lagging:false},maAlignment:70,ma20Slope:.2,obv1h:.2,repeatCount:2}),
    row("KRW-E",5,{repeatCount:2,mechanicalScore:72}),
    row("KRW-F",6,{recommendationEligible:true,repeatCount:2})
  ];
  const out=selectLeadingTop3(rows);
  assert.deepEqual(out.top3.map(x=>x.market),["KRW-F","KRW-D","KRW-E"]);
  assert.equal(out.top3.length,3);
});

test("5AI/ENTRY is an upgrade, not a requirement for TOP3",()=>{
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
