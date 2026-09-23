"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

test("private credit dashboard includes quarterly redemption watch windows and March reference drawdowns",()=>{
  const mod=fs.readFileSync(path.resolve(__dirname,"../src/dashboard-private-credit-quality-v1.js"),"utf8");
  assert.match(mod,/Q1 환매창/);
  assert.match(mod,/Q2 환매창/);
  assert.match(mod,/Q3 환매창/);
  assert.match(mod,/Q4 환매창/);
  assert.match(mod,/headlineDayPct:-3\.8/);
  assert.match(mod,/closeDrawdownPct:-11\.45/);
  assert.match(mod,/ARES/);
  assert.match(mod,/현재 진입/);
});
