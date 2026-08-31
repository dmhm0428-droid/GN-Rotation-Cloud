"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {formatResult,runUpbitPrePump}=require("../src/upbit-pre-pump-runner");

test("formats the public scanner result with validation fields and without private internals",()=>{
  const formatted=formatResult({market:"KRW-BTC",score:72.5,state:"ENTRY",return5m:.01,return15m:.025,turnoverGrowth15m:1.4,obvDirection:.8});
  assert.equal(formatted.market,"KRW-BTC");
  assert.equal(formatted.score,72.5);
  assert.equal(formatted.status,"ENTRY");
  assert.equal(formatted.return5m,.01);
  assert.equal(formatted.return15m,.025);
  assert.equal(formatted.turnoverGrowth15m,1.4);
  assert.equal(formatted.htfEntryBlocked,false);
  assert.equal(formatted.orderbookSignal,"UNKNOWN");
  assert.equal(formatted.individualRiskBlocked,false);
  assert.equal(Object.hasOwn(formatted,"obvDirection"),false);
});

test("returns at most three formatted candidates from an injected scanner",async()=>{
  let receivedOptions;
  let saved;
  const rows=Array.from({length:7},(_,index)=>({market:`KRW-${index}`,score:90-index,state:index?"SCOUT":"ENTRY",return5m:.01,return15m:.02,turnoverGrowth15m:1}));
  const fetchImpl=async url=>url.includes("/market/all")
    ?{ok:true,status:200,json:async()=>rows.map(row=>({market:row.market,market_warning:"NONE"}))}
    :{ok:false,status:404,json:async()=>[]};
  const result=await runUpbitPrePump({batchSize:4,fetchImpl,sleep:async()=>{},scanner:async options=>{receivedOptions=options;return rows;},save:async input=>{saved=input.candidates;}});
  assert.equal(result.length,3);
  assert.equal(saved.length,3);
  assert.equal(result[0].status,"ENTRY");
  assert.equal(receivedOptions.batchSize,4);
  assert.equal(receivedOptions.fetchImpl,fetchImpl);
});

test("runner uses no API key or order capability",async()=>{
  const fetchImpl=async()=>({ok:false,status:404,json:async()=>[]});
  const result=await runUpbitPrePump({fetchImpl,scanner:async()=>[],save:async()=>{}});
  assert.deepEqual(result,[]);
  assert.equal(JSON.stringify(result).includes("apiKey"),false);
});

test("database save failure does not prevent scanner results",async()=>{
  const row={market:"KRW-SAFE",score:55,state:"SCOUT",return5m:.01,return15m:.02,turnoverGrowth15m:.5};
  const fetchImpl=async url=>url.includes("/market/all")?{ok:true,status:200,json:async()=>[{market:"KRW-SAFE",market_warning:"NONE"}]}:{ok:false,status:404,json:async()=>[]};
  const result=await runUpbitPrePump({fetchImpl,sleep:async()=>{},scanner:async()=>[row],save:async()=>{throw new Error("mock save failure");}});
  assert.equal(result[0].market,"KRW-SAFE");
});
