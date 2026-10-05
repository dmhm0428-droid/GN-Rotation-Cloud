'use strict';
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const COLUMNS=['name','description','sector','industry','close','currency','Perf.1M','Perf.3M','typespecs','exchange'];
const SECTORS={'Electronic Technology':'전자·반도체','Technology Services':'소프트웨어·보안','Producer Manufacturing':'전력·산업장비','Utilities':'전력·가스','Industrial Services':'건설·산업서비스','Finance':'금융','Health Technology':'제약·바이오','Health Services':'의료서비스','Energy Minerals':'에너지','Non-Energy Minerals':'금속·소재','Process Industries':'화학·소재','Consumer Durables':'자동차·내구재','Consumer Non-Durables':'식품·소비재','Consumer Services':'소비자서비스','Retail Trade':'유통','Transportation':'운송','Communications':'통신','Commercial Services':'기업서비스','Distribution Services':'유통서비스','Miscellaneous':'기타'};
function parseCsv(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===','||c==='\n')){row.push(cell.replace(/\r$/,''));cell='';if(c==='\n'){rows.push(row);row=[];}}else cell+=c;}if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}const headers=rows.shift()||[];return rows.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(headers.map((h,i)=>[h.replace(/^\uFEFF/,''),r[i]||''])));}
function normalizeRows(scan,kind,krListing=[]){
 const mapping=new Map(krListing.map(x=>[String(x.Code||x.Symbol||'').padStart(6,'0'),x]));const out=[],seen=new Set();
 for(const raw of scan.data||[]){const d=Object.fromEntries(COLUMNS.map((k,i)=>[k,raw.d?.[i]]));if(!Array.isArray(d.typespecs)||!d.typespecs.some(x=>['common','dr'].includes(x)))continue;
  if(kind==='us'&&!['NASDAQ','NYSE','AMEX'].includes(d.exchange))continue;if(kind==='kr'&&d.exchange!=='KRX')continue;
  let symbol=String(d.name||'').replace(/\./g,'-'),name=d.description;let benchmark='SPY';if(kind==='kr'){const meta=mapping.get(String(d.name));if(!meta||!String(meta.Market).startsWith('KOS'))continue;symbol=String(d.name)+(String(meta.Market).startsWith('KOSDAQ')?'.KQ':'.KS');name=meta.Name||name;benchmark=symbol.endsWith('.KQ')?'^KQ11':'^KS11';}
  if(!symbol||seen.has(symbol))continue;seen.add(symbol);out.push({symbol,name,kind,benchmark,sector:SECTORS[d.sector]||d.sector||'기타',industry:d.industry||'',description:(SECTORS[d.sector]||d.sector||'업종')+' · '+(d.industry||'세부 업종 확인 중'),screen_return_1m:finite(d['Perf.1M'])?Number(d['Perf.1M']):null,screen_return_3m:finite(d['Perf.3M'])?Number(d['Perf.3M']):null,source:'https://scanner.tradingview.com/'+(kind==='us'?'america':'korea')+'/scan'});
 }return out;
}
function prioritize(rows,limit=24){
 const comparable=rows.filter(r=>finite(r.screen_return_1m)&&finite(r.screen_return_3m));
 const ranks={};for(const key of ['screen_return_1m','screen_return_3m']){const sorted=[...comparable].sort((a,b)=>a[key]-b[key]||a.symbol.localeCompare(b.symbol));sorted.forEach((r,i)=>(ranks[r.symbol]??={})[key]=i/Math.max(1,sorted.length-1));}
 const ordered=comparable.map(r=>({...r,discovery_priority:(ranks[r.symbol].screen_return_1m+ranks[r.symbol].screen_return_3m)/2})).sort((a,b)=>b.discovery_priority-a.discovery_priority||a.symbol.localeCompare(b.symbol));
 // This only orders the verification queue. It is never a leadership or buy gate.
 const chosen=[],seen=new Set();for(const r of ordered){if(seen.has(r.sector))continue;seen.add(r.sector);chosen.push(r);if(chosen.length===limit)return chosen;}
 for(const r of ordered){if(chosen.some(x=>x.symbol===r.symbol))continue;chosen.push(r);if(chosen.length===limit)break;}return chosen;
}
function validateSnapshot(x,now=Date.now()){
 const at=Date.parse(x?.published_at);if(x?.schema_version!==1||!Number.isFinite(at)||at>now||now-at>2*3600000||!Array.isArray(x.items)||!x.coverage)return null;
 if(!['us','kr'].every(k=>Number.isInteger(x.coverage[k]?.discovered)&&x.coverage[k].discovered>=0&&Number.isInteger(x.coverage[k]?.deep_checked)&&x.coverage[k].deep_checked>=0))return null;
 return x;
}
let installed;
function createDiscoveryService(fetcher=fetch,clock=Date.now){let cache=null,last=0,pending=null,error=null;
 async function refresh(){if(pending||last&&clock()-last<300000)return pending;last=clock();pending=(async()=>{try{const r=await fetcher('https://raw.githubusercontent.com/dmhm0428-droid/GN-Rotation-Cloud/gn-verified-data/gn-market-candidates.json',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('SOURCE_UNAVAILABLE');const x=validateSnapshot(await r.json(),clock());if(!x)throw Error('SOURCE_STALE_OR_INVALID');cache=x;error=null;}catch(e){error=e.message==='SOURCE_STALE_OR_INVALID'?e.message:'SOURCE_UNAVAILABLE';if(cache&&!validateSnapshot(cache,clock()))cache=null;}})().finally(()=>pending=null);return pending;}
 function read(){if(cache&&!validateSnapshot(cache,clock()))cache=null;void refresh();return {...(cache||{items:[],coverage:{},published_at:null}),source_error:error,market_verdict:'INCOMPLETE',note:'후보 탐색과 전체 투자기준 통과는 별도입니다. 미확인은 탈락이 아닙니다.'};}
 function health(){return {running:!!pending,published_at:cache?.published_at||null,coverage:cache?.coverage||{},source_error:error,market_verdict:'INCOMPLETE'};}return {refresh,read,health};
}
function installDiscovery(app){installed=createDiscoveryService();app.get('/api/gn-market-candidates',(req,res)=>{res.set('Cache-Control','no-store');res.json(installed.read());});void installed.refresh();const timer=setInterval(()=>void installed.refresh(),300000);timer.unref();return installed;}
function discoveryHealth(){return installed?.health()||{};}
module.exports={COLUMNS,parseCsv,normalizeRows,prioritize,validateSnapshot,createDiscoveryService,installDiscovery,discoveryHealth};
