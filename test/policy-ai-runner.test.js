"use strict";
const test=require("node:test");const assert=require("node:assert/strict");
const {AXES,audited,axesOf,secondBundle,successful}=require("../src/policy-ai-runner");
const names=["perplexity","xai","deepseek","anthropic","gemini"];
function row(name,event=true){return {provider:name,status:"success",summary:"ok",signals:["GN_DATA_VERDICT:PASS",`GN_NEW_EVENT:${event}`,"GN_POLICY_AXES:LIQUIDITY_SUPPLY","GN_OFFICIAL_EVIDENCE:official","GN_COUNTER_EVIDENCE:none"]};}
test("requires all five providers",()=>{assert.equal(successful(names.map(row)),true);assert.equal(successful(names.slice(0,4).map(row)),false);});
test("reverse audit requires five explicit passes",()=>{const rows=names.map(row);assert.equal(audited(rows),true);rows[2].signals[0]="GN_DATA_VERDICT:PARTIAL";assert.equal(audited(rows),false);});
test("keeps fixed detected axes only",()=>{assert.deepEqual(axesOf(names.map(row)),["LIQUIDITY_SUPPLY"]);assert.equal(AXES.length,6);});
test("second pass is adversarial mode",()=>{const b=secondBundle({gn_contract:{mode:"BIG_PICTURE_POLICY_FIVE_AI"}},names.map(row));assert.match(b.gn_contract.mode,/REVERSE/);assert.equal(b.first_pass_claims.length,5);});
