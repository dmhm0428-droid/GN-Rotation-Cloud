'use strict';
const fs=require('node:fs');
const {collectSymbol}=require('../src/gn-fundamentals');
(async()=>{
 const items=[];
 for(const symbol of ['VRT','GEV','010120.KS','267260.KS'])items.push(await collectSymbol(symbol));
 const snapshot={schema_version:1,collection_path:'GITHUB_ACTIONS_PUBLIC_SOURCE',published_at:new Date().toISOString(),items};
 fs.writeFileSync(process.argv[2]||'/tmp/gn-fundamentals.json',JSON.stringify(snapshot));
 console.log(JSON.stringify({symbols:items.length,eps_confirmed:items.filter(x=>x.checks.estimates.verified).length}));
})().catch(()=>{console.error('COLLECTOR_FAILED');process.exit(1);});
