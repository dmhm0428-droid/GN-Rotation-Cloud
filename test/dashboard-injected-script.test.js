"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

function injectedBody(file,id){
  const src=fs.readFileSync(path.resolve(__dirname,"..","src",file),"utf8");
  const marker=`<script id="${id}">`;
  const start=src.indexOf(marker);
  assert.notEqual(start,-1,`${id} marker missing`);
  const bodyStart=start+marker.length;
  const end=src.indexOf("</script>",bodyStart);
  assert.notEqual(end,-1,`${id} closing script missing`);
  return src.slice(bodyStart,end);
}

test("partial loader injected browser JavaScript parses",()=>{
  const body=injectedBody("dashboard-partial-loading-v1.js","gn-partial-loading-v1");
  assert.doesNotThrow(()=>new Function(body));
});

test("single TOP3 renderer injected browser JavaScript parses",()=>{
  const body=injectedBody("dashboard-leading-top3-v2.js","gn-leading-top3-v2-ui");
  assert.doesNotThrow(()=>new Function(body));
});

test("policy dashboard injected browser JavaScript parses",()=>{
  const body=injectedBody("dashboard-policy-detected-v1.js","gn-policy-detected-script-v1");
  assert.doesNotThrow(()=>new Function(body));
});

test("policy dashboard always renders six fixed headings and hides legacy scorecard",()=>{
  const policy=fs.readFileSync(path.resolve(__dirname,"..","src","dashboard-policy-detected-v1.js"),"utf8");
  const authoritative=fs.readFileSync(path.resolve(__dirname,"..","src","dashboard-authoritative-v1.js"),"utf8");
  for(const label of ["장기채 안정","유가 안정","유동성 공급","AI 기업 투자속도·정부지원","전력·비트코인 채굴·국가안보","투자 연결"]){
    assert.match(policy,new RegExp(label));
  }
  assert.match(policy,/STATIC_ROWS/);
  assert.match(policy,/render\(null\);try/);
  assert.match(authoritative,/id="legacyPolicyEarlyWarning" style="display:none"/);
});

test("authoritative stock tabs show live prices without stale fixed buy ranges",()=>{
  const src=fs.readFileSync(path.resolve(__dirname,"..","src","dashboard-authoritative-v1.js"),"utf8");
  assert.match(src,/\/api\/risk-buy-fx/);
  assert.match(src,/AI전력 · 현재가/);
  assert.match(src,/AI전력·AI네트워크 · 현재가/);
  assert.doesNotMatch(src,/현재가 · 1차 · 2차 매수가/);
});
