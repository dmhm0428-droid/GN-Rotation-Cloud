"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

test("private-credit quality dashboard is wired with verified risk and quality gates",()=>{
  const mod=fs.readFileSync(path.resolve(__dirname,"../src/dashboard-private-credit-quality-v1.js"),"utf8");
  const start=fs.readFileSync(path.resolve(__dirname,"../src/start.js"),"utf8");
  assert.match(start,/dashboard-private-credit-quality-v1\.js/);
  assert.match(mod,/Apollo/);
  assert.match(mod,/14\.7/);
  assert.match(mod,/81/);
  assert.match(mod,/MNDY/);
  assert.match(mod,/FUNDAMENTALS_PASS/);
  assert.match(mod,/QUALITY DIP/);
  assert.match(mod,/영업현금흐름/);
  assert.match(mod,/섹터 동반하락/);
});
