"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

test("bank capacity is merged into existing investment link without duplicate panel injection",()=>{
  const bank=fs.readFileSync(path.resolve(__dirname,"../src/dashboard-bank-capacity-treasury-v1.js"),"utf8");
  const link=fs.readFileSync(path.resolve(__dirname,"../src/dashboard-investment-link-v1.js"),"utf8");
  assert.match(bank,/function patchHtml\(html\)\{return html;\}/);
  assert.match(link,/\/api\/bank-capacity-treasury/);
  assert.match(link,/Bessent × Bowman 연결/);
  assert.match(link,/INVESTMENT_LINK/);
  assert.match(link,/직접 수혜 감시/);
  assert.doesNotMatch(link,/id="gnBankCapacity"/);
});
