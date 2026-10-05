'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseCsv,normalizeRows,prioritize,validateSnapshot}=require('../src/gn-market-discovery');
const raw=(name,sector,one,three,types=['common'],exchange='NYSE')=>({s:exchange+':'+name,d:[name,name,sector,'Industry',10,'USD',one,three,types,exchange]});
test('market discovery excludes preferred/OTC and maps KOSDAQ with dated listing names',()=>{
 const rows=normalizeRows({data:[raw('AAA','Finance',1,2),raw('BBB','Finance',2,3,['preferred']),raw('CCC','Finance',3,4,['common'],'OTC')]},'us');assert.deepEqual(rows.map(x=>x.symbol),['AAA']);
 const listing=parseCsv('\uFEFF,Code,Name,Market\n0,123456,"회사,이름",KOSDAQ GLOBAL\n');
 const kr=normalizeRows({data:[raw('123456','Finance',1,2,['common'],'KRX')]},'kr',listing);assert.equal(kr[0].symbol,'123456.KQ');assert.equal(kr[0].name,'회사,이름');assert.equal(kr[0].benchmark,'^KQ11');
});
test('verification priority changes with fresh rankings and covers sectors rather than a fixed four',()=>{
 const u=normalizeRows({data:[raw('AAA','Finance',1,2),raw('BBB','Finance',2,3),raw('CCC','Utilities',1,2)]},'us');const first=prioritize(u,2);assert.ok(first.some(x=>x.symbol==='BBB'));assert.ok(first.some(x=>x.symbol==='CCC'));
 u[0].screen_return_1m=10;u[0].screen_return_3m=20;assert.ok(prioritize(u,2).some(x=>x.symbol==='AAA'));assert.ok(prioritize(u,2).every(x=>x.components===undefined));
});
test('expired discovery snapshots cannot imply a current market verdict',()=>{
 const now=Date.now(),x={schema_version:1,published_at:new Date(now-1000).toISOString(),items:[],coverage:{us:{discovered:4000,deep_checked:24},kr:{discovered:2000,deep_checked:24}}};assert.equal(validateSnapshot(x,now),x);assert.equal(validateSnapshot(x,now+3*3600000),null);assert.equal(validateSnapshot({...x,published_at:new Date(now+1000).toISOString()},now),null);
});
