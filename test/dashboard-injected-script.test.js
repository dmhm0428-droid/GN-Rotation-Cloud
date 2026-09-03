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
