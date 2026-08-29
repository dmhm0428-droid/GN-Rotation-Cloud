"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const patch=fs.readFileSync(path.join(__dirname,"../src/dashboard-resilience-patch.js"),"utf8");
const start=fs.readFileSync(path.join(__dirname,"../src/start.js"),"utf8");

test("dashboard resilience patch bounds every client request",()=>{
  assert.match(patch,/setTimeout\(function\(\)\{c\.abort\(\);\},8000\)/);
  assert.match(patch,/getJson\('\/api\/flow-map'\)/);
  assert.match(patch,/getJson\('\/api\/portfolio'\)/);
  assert.match(patch,/getJson\('\/api\/stock-quotes'\)/);
  assert.match(patch,/getJson\('\/api\/etf\/latest'\)/);
});

test("dashboard sections fail independently instead of infinite loading",()=>{
  assert.match(patch,/시장 판정 데이터 지연/);
  assert.match(patch,/TOP3 검증 데이터 지연/);
  assert.match(patch,/퇴직연금 ETF 시세 지연/);
  assert.match(patch,/보유자산 조회 지연/);
  assert.match(patch,/window\.loadAll=resilientLoadAll/);
});

test("portfolio renderer understands exchange portfolio response",()=>{
  assert.match(patch,/p&&p\.exchanges/);
  assert.match(patch,/x\.positions\|\|\[\]/);
  assert.match(patch,/보유자산 연결 오류/);
});

test("resilience response patch survives final dashboard replacement",()=>{
  const finalPos=start.indexOf('final-dashboard-patch.js');
  const resiliencePos=start.indexOf('dashboard-resilience-patch.js');
  assert.ok(finalPos>=0);
  assert.ok(resiliencePos>=0);
  // NODE_OPTIONS requires in list order, but Express response wrappers execute
  // in reverse middleware order. Resilience must therefore be required BEFORE
  // final-dashboard so its response patch runs AFTER final body replacement.
  assert.ok(resiliencePos<finalPos);
});
