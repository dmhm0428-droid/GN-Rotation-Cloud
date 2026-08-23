"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {ADAPTERS,loadPortfolio}=require("../src/exchange-portfolio");

test("four exchange adapters are registered",()=>{assert.deepEqual(Object.keys(ADAPTERS).sort(),["bithumb","mexc","okx","upbit"]);});

test("portfolio stays read-only and skips exchanges without keys",async()=>{let calls=0;const result=await loadPortfolio({env:{},fetchImpl:async()=>{calls++;throw new Error("should not call");}});assert.equal(calls,0);assert.equal(result.exchanges.length,4);for(const row of result.exchanges){assert.equal(row.enabled,false);assert.deepEqual(row.positions,[]);assert.equal(row.error,null);}});
