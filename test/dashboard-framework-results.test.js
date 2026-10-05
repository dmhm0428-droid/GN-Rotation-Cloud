"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
process.env.GN_FRAMEWORK_PATCH_TEST='1';
const {patchHtml,CLIENT_JS}=require('../src/dashboard-framework-navigation-v1');
const {createFrameworkPolicy}=require('../src/gn-framework-screen-policy');
test('result screen preserves existing live DOM without the document dump',()=>{
 const original='<title>GN PIVOT</title><body><div id="tabBody"></div><script>window.refreshGN=()=>1;</script></body>';
 const actual=patchHtml(original);assert.ok(actual.includes('id="tabBody"'));assert.ok(!actual.includes('window.refreshGN=()=>1'));assert.equal(patchHtml(actual),actual);assert.doesNotThrow(()=>new Function(CLIENT_JS));assert.ok(!CLIENT_JS.includes('사진의 역사 비교'));assert.ok(CLIENT_JS.includes('/api/live-summary'));assert.ok(CLIENT_JS.includes('검증 통과 종목'));
});
const P=createFrameworkPolicy(),now=Date.now(),valid=()=>({verified:true,status:'PASS',sources:['official evidence'],observed_at:new Date(now-1000).toISOString(),valid_until:new Date(now+60000).toISOString()});
function complete(){const gates=Object.fromEntries(P.STAGES.map(([k])=>[k,valid()]));gates.company_quality.checks=Object.fromEntries(P.QUALITY.map(([k])=>[k,valid()]));Object.assign(gates.execution,{buy_krw:100,invalidation_krw:90,recovery_krw:120,review_at:new Date(now+60000).toISOString()});return {kind:'us',price:100,components:{gn_framework:gates}};}
test('scores and claims cannot substitute for required evidence',()=>{assert.equal(P.assess({price:100,total_score:99,action:'ENTRY'},now).eligible,false);const r=complete();assert.equal(P.assess(r,now).eligible,true);r.components.gn_framework.company_quality.checks.cashflow.sources=[];assert.equal(P.assess(r,now).eligible,false);});
test('expired proof and failed quality block selection',()=>{const r=complete();r.components.gn_framework.money_rate_cause.valid_until=new Date(now-1).toISOString();assert.equal(P.assess(r,now).eligible,false);const f=complete();f.components.gn_framework.company_quality.checks.pricing_power.status='FAIL';assert.equal(P.assess(f,now).state,'미통과');});
test('null and stale FX never become invented KRW prices',()=>{assert.equal(P.krwQuote(null,'KRW',null,now),null);assert.equal(P.krwQuote(100,'USD',{price:1300,tradedAt:new Date(now-1000).toISOString()},now),130000);assert.equal(P.krwQuote(100,'USD',{price:1300,tradedAt:new Date(now-25*3600000).toISOString()},now),null);});
test('crypto uses its own gate rather than corporate EPS and ROIC',()=>{const r=complete();r.kind='crypto';delete r.components.gn_framework.company_quality;r.components.gn_framework.crypto_quality=valid();assert.equal(P.assess(r,now).eligible,true);assert.equal(P.assess(r,now).gates[3].label,'크립토 현물·파생·유동성');});
