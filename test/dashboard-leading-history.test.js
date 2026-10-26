"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");

// Avoid loading the database-backed dashboard wrapper in this focused regression test.
const fs=require("node:fs");

test("leading dashboard only reconstructs a fresh 30-minute flow history from stored snapshots",()=>{
  const source=fs.readFileSync(require.resolve("../src/dashboard-leading-top3-v2"),"utf8");
  assert.match(source,/HISTORY_MS=35\*60\*1000/);
  assert.match(source,/1\+growth/);
  assert.match(source,/repeatCount:recent30\.length/);
  assert.match(source,/volumeTimeSeries:Array\.isArray\(r\.volumeTimeSeries\).*history\.volumeTimeSeries/);
});
