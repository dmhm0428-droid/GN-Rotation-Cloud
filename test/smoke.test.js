"use strict";

const test=require("node:test");const assert=require("node:assert/strict");
const {scoreMarket}=require("../src/market");const {loadAiConfig}=require("../src/ai/config");const {analyzeSnapshot}=require("../src/ai/analyzer");

test("existing GN score remains deterministic while AI is disabled",async()=>{
  const input={spot:{breadth100:.5,median100:0,volumeWeighted100:0},funding:{hot:.1,veryHot:.03,median:0},taker:{avg15m:1},btc:{r1:0,r24:0},macroScore:5};
  const before=scoreMarket(input);let networkCalled=false;const ai=await analyzeSnapshot(before,loadAiConfig({}),{transport:async()=>{networkCalled=true;}});const after=scoreMarket(input);
  assert.deepEqual(after,before);assert.deepEqual(ai,[]);assert.equal(networkCalled,false);
});
