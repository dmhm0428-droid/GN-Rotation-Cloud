"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {cashFromFacts,estimatesFromTrend,cashFromTimeseries}=require('../src/gn-fundamentals');
const now=Date.parse('2026-10-05T12:00:00Z');
const annual=(year,val)=>({start:year+'-01-01',end:year+'-12-31',val,form:'10-K',filed:(year+1)+'-02-15'});
const ytd=(year,val)=>({start:year+'-01-01',end:year+'-06-30',val,form:'10-Q',filed:year+'-07-30'});
function facts(){return {facts:{'us-gaap':Object.fromEntries([['NetCashProvidedByUsedInOperatingActivities',[annual(2024,100),annual(2025,150),ytd(2024,40),ytd(2025,50),ytd(2026,90)]],['PaymentsToAcquirePropertyPlantAndEquipment',[annual(2025,30),ytd(2025,10),ytd(2026,15)]],['ShareBasedCompensation',[annual(2025,5),ytd(2025,2),ytd(2026,3)]]].map(([k,v])=>[k,{units:{USD:v}}]))}};}
test('cash uses annual plus YTD minus prior YTD for both TTM periods',()=>{const c=cashFromFacts(facts(),'SEC',now);assert.equal(c.metrics.ocf_ttm,190);assert.equal(c.metrics.ocf_prior_ttm,110);assert.equal(c.metrics.fcf_ttm,155);assert.equal(c.status,'PASS');});
test('missing comparable cash and future filings cannot pass',()=>{const f=facts();f.facts['us-gaap'].NetCashProvidedByUsedInOperatingActivities.units.USD[0].filed='2027-01-01';assert.equal(cashFromFacts(f,'SEC',now).status,'UNKNOWN');assert.equal(cashFromFacts({},'SEC',now).status,'UNKNOWN');});
test('EPS requires same-period 30 and 90 day comparisons and analyst coverage',()=>{const row=(period,endDate)=>({period,endDate,epsTrend:{current:{raw:3},'30daysAgo':{raw:2},'90daysAgo':{raw:1}},earningsEstimate:{numberOfAnalysts:{raw:10}}});const rows=[row('+1q','2026-12-31'),row('+1y','2027-12-31')];assert.equal(estimatesFromTrend(rows,'provider',now).status,'PASS');rows[0].epsTrend['90daysAgo']={raw:null};assert.equal(estimatesFromTrend(rows,'provider',now).status,'UNKNOWN');});
test('Korean incomplete or duplicate quarterly periods never create a cash pass',()=>{assert.equal(cashFromTimeseries({},'provider',now).status,'UNKNOWN');});
