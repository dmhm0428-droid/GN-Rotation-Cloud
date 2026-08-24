"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {createLatestPrePumpHandler,loadLatestPrePump}=require("../src/pre-pump-dashboard");

function chain(result){
  const query={
    select(){return query;},
    order(){return query;},
    limit(){return query;},
    eq(){return query;},
    maybeSingle:async()=>result,
    then(resolve){return Promise.resolve(result).then(resolve);}
  };
  return query;
}

function mockDb({latest,rows,marketRows,latestError,rowsError,marketError}={}){
  let prePumpCalls=0;
  return {
    from(table){
      if(table==="gn_pre_pump_snapshots"){
        prePumpCalls+=1;
        if(prePumpCalls===1)return chain({data:latest||null,error:latestError||null});
        return chain({data:rows||[],error:rowsError||null});
      }
      if(table==="gn_market_snapshots")return chain({data:marketRows||[],error:marketError||null});
      throw new Error(`unexpected table ${table}`);
    }
  };
}

function row({rank,market,score,status="ENTRY",r5=.01,r15=.02,late=false,blocked=false}){
  return {
    rank,market,score,status,
    return5m:r5,return15m:r15,volume_ratio15m:1.2,krw_price:1000,
    details:{
      market_context:{marketScore:61,warOverride:false},
      late_pump:late?{latePumpRisk:true}:null,
      orderbook:blocked?{entry_blocked:true,signal:"ASK_WALL"}:{entry_blocked:false,signal:"BID_DEFENSE"},
      daily_ignition:{available:true,score:60}
    },
    ts:"2026-08-24T03:00:00Z"
  };
}

test("TOP3 contains at most three current entry candidates in priority order",async()=>{
  const db=mockDb({
    latest:{run_id:"run-latest",ts:"2026-08-24T03:00:00Z"},
    marketRows:[{market_score:61},{market_score:60},{market_score:59},{market_score:58}],
    rows:[
      row({rank:1,market:"KRW-A",score:80}),
      row({rank:2,market:"KRW-B",score:76}),
      row({rank:3,market:"KRW-C",score:72}),
      row({rank:4,market:"KRW-D",score:70})
    ]
  });
  const result=await loadLatestPrePump(db);
  assert.equal(result.length,3);
  assert.deepEqual(result.map(x=>x.market),["KRW-A","KRW-B","KRW-C"]);
  assert.deepEqual(result.map(x=>x.rank),[1,2,3]);
  assert.ok(result.every(x=>x.action==="진입"));
});

test("TOP3 excludes overheat, late-pump and non-entry scanner states",async()=>{
  const db=mockDb({
    latest:{run_id:"run-latest",ts:"2026-08-24T03:00:00Z"},
    marketRows:[{market_score:61},{market_score:61}],
    rows:[
      row({rank:1,market:"KRW-HOT",score:85}),
      row({rank:2,market:"KRW-LATE",score:80,late:true}),
      row({rank:3,market:"KRW-HOLD",score:79,status:"HOLD"}),
      row({rank:4,market:"KRW-OK",score:78})
    ]
  });
  const result=await loadLatestPrePump(db);
  assert.deepEqual(result.map(x=>x.market),["KRW-OK"]);
});

test("orderbook-blocked candidate is clearly marked entry-wait, never sell/holding",async()=>{
  const db=mockDb({
    latest:{run_id:"run-latest",ts:"2026-08-24T03:00:00Z"},
    marketRows:[{market_score:61},{market_score:61}],
    rows:[row({rank:1,market:"KRW-WAIT",score:79,blocked:true})]
  });
  const result=await loadLatestPrePump(db);
  assert.equal(result.length,1);
  assert.equal(result[0].action,"진입대기");
  assert.equal(result[0].rank,1);
});

test("returns an empty list when scanner data does not exist",async()=>{
  assert.deepEqual(await loadLatestPrePump(mockDb()),[]);
});

test("handler contains mocked database errors",async()=>{
  const handler=createLatestPrePumpHandler({db:{},load:async()=>{throw new Error("mock database failure");}});
  const response={code:null,body:null,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler({},response);
  assert.equal(response.code,500);
  assert.deepEqual(response.body,{error:"mock database failure"});
});
