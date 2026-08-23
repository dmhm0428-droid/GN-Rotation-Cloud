"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {savePrePumpScan,snapshotRows}=require("../src/pre-pump-store");

function candidates(){return [{market:"KRW-AAA",score:72,state:"ENTRY",return5m:.01,return15m:.03,turnoverGrowth15m:1.2,obvDirection:.7,higherLow15m:true,resistanceProximity15m:-.01,structure1h:"sideways_breakout",derivativeScore:60,derivativeDataAvailable:true}];}

test("maps TOP3 candidates to dedicated snapshots linked to gn_runs",()=>{
  const rows=snapshotRows(candidates(),"run-1","2026-01-01T00:00:00Z");
  assert.equal(rows[0].run_id,"run-1");
  assert.equal(rows[0].rank,1);
  assert.equal(rows[0].volume_ratio15m,1.2);
  assert.deepEqual(rows[0].details.derivatives,{score:60,data_available:true});
});

test("skips persistence when Supabase environment is absent",async()=>{
  const result=await savePrePumpScan({candidates:candidates(),env:{}});
  assert.deepEqual(result,{stored:false,skipped:true,cause:"missing_supabase_environment"});
});

test("records one run and its candidates with a mock repository",async()=>{
  const calls=[];
  const repository={
    async start(ts){calls.push(["start",ts]);return "run-1";},
    async insertCandidates(rows){calls.push(["insert",rows]);},
    async finish(id,status,ts){calls.push(["finish",id,status,ts]);}
  };
  const result=await savePrePumpScan({candidates:candidates(),repository,now:()=>"2026-01-01T00:00:00Z"});
  assert.equal(result.stored,true);
  assert.equal(calls.filter(call=>call[0]==="start").length,1);
  assert.equal(calls.find(call=>call[0]==="insert")[1].length,1);
  assert.equal(calls.at(-1)[2],"success");
});

test("contains database failure and marks the run as error",async()=>{
  const finishes=[];
  const repository={
    async start(){return "run-1";},
    async insertCandidates(){throw new Error("mock database failure");},
    async finish(id,status){finishes.push([id,status]);}
  };
  const result=await savePrePumpScan({candidates:candidates(),repository});
  assert.equal(result.stored,false);
  assert.deepEqual(finishes,[["run-1","error"]]);
});
