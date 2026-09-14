"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");

test("buy prices are never attached to SCOUT or unverified ENTRY rows",()=>{
  const fs=require("node:fs");
  const source=fs.readFileSync(require.resolve("../src/dashboard-top3-buy-plan-v1"),"utf8");
  assert.match(source,/status!=="ENTRY"/);
  assert.match(source,/fiveAi!==true/);
  assert.match(source,/validationConfidence\)<90/);
});
