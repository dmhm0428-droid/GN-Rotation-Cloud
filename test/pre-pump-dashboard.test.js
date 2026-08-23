"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {createLatestPrePumpHandler,loadLatestPrePump}=require("../src/pre-pump-dashboard");

function mockDb({latest,rows,latestError,rowsError}={}){
  let call=0;
  return {from(table){
    assert.equal(table,"gn_pre_pump_snapshots");
    call+=1;
    const query={
      select(){return query;},order(){return query;},limit(){return query;},eq(){return query;},
      maybeSingle:async()=>({data:latest||null,error:latestError||null}),
      then(resolve){return Promise.resolve({data:rows||[],error:rowsError||null}).then(resolve);}
    };
    if(call===1)return query;
    return query;
  }};
}

test("loads only TOP3 from the latest scanner run",async()=>{
  const db=mockDb({latest:{run_id:"run-latest",ts:"2026-08-23T00:00:00Z"},rows:[
    {rank:1,market:"KRW-AAA",score:81,status:"ENTRY",return5m:1.2,return15m:2.5,volume_ratio15m:120,ts:"2026-08-23T00:00:00Z"}
  ]});
  const result=await loadLatestPrePump(db);
  assert.deepEqual(result,[{rank:1,market:"KRW-AAA",score:81,status:"ENTRY",return5m:1.2,return15m:2.5,volumeRatio15m:120,updated_at:"2026-08-23T00:00:00Z"}]);
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
