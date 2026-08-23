"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {formatResult,runUpbitPrePump}=require("../src/upbit-pre-pump-runner");

test("formats the public scanner result without exposing internal fields",()=>{
  const formatted=formatResult({market:"KRW-BTC",score:72.5,state:"ENTRY",return5m:.01,return15m:.025,turnoverGrowth15m:1.4,obvDirection:.8});
  assert.deepEqual(formatted,{market:"KRW-BTC",score:72.5,status:"ENTRY",return5m:.01,return15m:.025,turnoverGrowth15m:1.4});
});

test("returns at most three formatted candidates from an injected scanner",async()=>{
  let receivedOptions;
  let saved;
  const rows=Array.from({length:7},(_,index)=>({market:`KRW-${index}`,score:90-index,state:index?"SCOUT":"ENTRY",return5m:.01,return15m:.02,turnoverGrowth15m:1}));
  const result=await runUpbitPrePump({batchSize:4,scanner:async options=>{receivedOptions=options;return rows;},save:async input=>{saved=input.candidates;}});
  assert.equal(result.length,3);
  assert.equal(saved.length,3);
  assert.equal(result[0].status,"ENTRY");
  assert.deepEqual(receivedOptions,{batchSize:4});
});

test("runner uses no API key or order capability",async()=>{
  const result=await runUpbitPrePump({scanner:async()=>[],save:async()=>{}});
  assert.deepEqual(result,[]);
  assert.equal(JSON.stringify(result).includes("apiKey"),false);
});

test("database save failure does not prevent scanner results",async()=>{
  const row={market:"KRW-SAFE",score:55,state:"SCOUT",return5m:.01,return15m:.02,turnoverGrowth15m:.5};
  const result=await runUpbitPrePump({scanner:async()=>[row],save:async()=>{throw new Error("mock save failure");}});
  assert.equal(result[0].market,"KRW-SAFE");
});
