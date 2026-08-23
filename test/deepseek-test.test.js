"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {createDeepSeekTestHandler,deepSeekOnlyConfig}=require("../src/ai/deepseek-admin");

function response(){
  return {code:null,body:null,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
}
function repository(){
  let row=null;
  return {
    async findExisting(){return row;},
    async latestSnapshot(){return {ts:"2026-01-01T00:00:00Z",market_score:50};},
    async reserve(){row={id:1,status:"skipped"};return row;},
    async markSuccess(id){assert.equal(id,1);row={id,status:"success"};},
    async markFailure(id){row={id,status:"error"};},
    async verify(){return row;}
  };
}

test("endpoint is unavailable unless explicitly enabled",async()=>{
  let calls=0;
  const handler=createDeepSeekTestHandler({env:{AI_TEST_ENABLED:"false"},repository:repository(),invoke:async()=>{calls++;}});
  const res=response();
  await handler({},res);
  assert.equal(res.code,404);
  assert.equal(calls,0);
});

test("forces DeepSeek only, stores success, and blocks a second execution",async()=>{
  const repo=repository();
  let calls=0;
  const env={AI_TEST_ENABLED:"true",DEEPSEEK_API_KEY:"not-a-real-key",PERPLEXITY_ENABLED:"true",XAI_ENABLED:"true"};
  const handler=createDeepSeekTestHandler({env,repository:repo,invoke:async provider=>{
    calls++;
    assert.equal(provider.name,"deepseek");
    return {summary:"safe",sentiment:"neutral",confidence:.5,signals:[],usage:{total_tokens:3},costUsd:.001};
  }});
  const first=response();
  await handler({},first);
  assert.equal(first.code,200);
  assert.deepEqual(first.body,{success:true,stored:true,cause:"saved"});
  const second=response();
  await handler({},second);
  assert.equal(second.code,409);
  assert.equal(second.body.cause,"already_executed");
  assert.equal(calls,1);
});

test("configuration ignores enabled flags for other providers",()=>{
  const provider=deepSeekOnlyConfig({DEEPSEEK_API_KEY:"d",PERPLEXITY_ENABLED:"true",XAI_ENABLED:"true"});
  assert.equal(provider.name,"deepseek");
  assert.equal(provider.enabled,true);
});
