"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

test("bank capacity dashboard links Bessent Bowman Treasury and private credit",()=>{
  const mod=fs.readFileSync(path.resolve(__dirname,"../src/dashboard-bank-capacity-treasury-v1.js"),"utf8");
  const start=fs.readFileSync(path.resolve(__dirname,"../src/start.js"),"utf8");
  assert.match(start,/dashboard-bank-capacity-treasury-v1\.js/);
  assert.match(mod,/Bessent/);
  assert.match(mod,/Bowman/);
  assert.match(mod,/eSLR/);
  assert.match(mod,/739/);
  assert.match(mod,/628/);
  assert.match(mod,/BlackRock/);
  assert.match(mod,/JPMorgan/);
  assert.match(mod,/Citigroup/);
  assert.match(mod,/대출\/중개 capacity/);
});
