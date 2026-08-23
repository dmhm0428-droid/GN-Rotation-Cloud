"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {filterUnsafeCandidates}=require("../src/upbit-pre-pump-runner");

test("filters STORJ and Upbit caution markets before TOP3 output",async()=>{
  const rows=[
    {market:"KRW-STORJ",score:90},
    {market:"KRW-CAUTION",score:85},
    {market:"KRW-SAFE",score:80}
  ];
  const fetchImpl=async url=>{
    assert.match(url,/market\/all\?isDetails=true/);
    return {ok:true,status:200,json:async()=>[
      {market:"KRW-STORJ",market_warning:"NONE"},
      {market:"KRW-CAUTION",market_warning:"CAUTION"},
      {market:"KRW-SAFE",market_warning:"NONE"}
    ]};
  };
  const filtered=await filterUnsafeCandidates(rows,{fetchImpl,env:{}});
  assert.deepEqual(filtered.map(row=>row.market),["KRW-SAFE"]);
});

test("supports emergency blocklist from PRE_PUMP_BLOCKED_MARKETS",async()=>{
  const rows=[{market:"KRW-AAA"},{market:"KRW-BBB"}];
  const fetchImpl=async()=>({ok:false,status:503,json:async()=>[]});
  const filtered=await filterUnsafeCandidates(rows,{fetchImpl,env:{PRE_PUMP_BLOCKED_MARKETS:"KRW-BBB"}});
  assert.deepEqual(filtered.map(row=>row.market),["KRW-AAA"]);
});
