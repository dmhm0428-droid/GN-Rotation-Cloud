"use strict";
const DAY=86400000;
const HORIZONS={return_1m:30,return_3m:90,return_6m:182,return_9m:274,return_12m:365,return_2y:730};
const SPECS=[['IREN','us','SPY'],['AVGO','us','SPY'],['VRT','us','SPY'],['MNDY','us','SPY'],['GEV','us','SPY'],['000660.KS','kr','^KS11'],['010120.KS','kr','^KS11'],['267260.KS','kr','^KS11']];
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
function chartEvidence(data,symbol,now=Date.now()){
 const x=data?.chart?.result?.[0],meta=x?.meta||{},close=x?.indicators?.adjclose?.[0]?.adjclose||x?.indicators?.quote?.[0]?.close||[];
 const points=(x?.timestamp||[]).map((t,i)=>({ts:Number(t)*1000,close:close[i]})).filter(p=>Number.isFinite(p.ts)&&p.ts<=now&&finite(p.close)&&Number(p.close)>0).map(p=>({...p,close:Number(p.close)})).sort((a,b)=>a.ts-b.ts);
 const duplicate=points.some((p,i)=>i&&p.ts===points[i-1].ts);const last=points.at(-1);
 const fresh=last&&now-last.ts<=4*DAY;const price=finite(meta.regularMarketPrice)&&Number(meta.regularMarketPrice)>0?Number(meta.regularMarketPrice):null;
 const tradedAt=meta.regularMarketTime?new Date(Number(meta.regularMarketTime)*1000).toISOString():null;
 const priceFresh=price!==null&&Number.isFinite(Date.parse(tradedAt))&&Date.parse(tradedAt)<=now&&now-Date.parse(tradedAt)<=4*DAY;
 const source='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol);
 const ret=days=>{const target=last?.ts-days*DAY,p=points.filter(p=>p.ts<=target).at(-1);return p&&target-p.ts<7*DAY?(last.close/p.close-1)*100:null;};
 const ma=n=>points.length>=n?points.slice(-n).reduce((s,p)=>s+p.close,0)/n:null;
 return {symbol,price,currency:meta.currency,source,tradedAt,price_verified:!!priceFresh,chart_verified:!!(fresh&&!duplicate&&points.length>=200),observed_at:new Date(now).toISOString(),chart_at:last?new Date(last.ts).toISOString():null,metrics:{...Object.fromEntries(Object.entries(HORIZONS).map(([k,d])=>[k,ret(d)])),ma20:ma(20),ma60:ma(60),ma120:ma(120),ma200:ma(200)},error:!priceFresh?'최근 거래시세 미확인':!fresh?'차트 관측일 오래됨':duplicate?'차트 날짜 중복':points.length<200?'200일 차트 자료 부족':null};
}
function relativeStrength(stock,benchmark){
 const aligned=stock.chart_verified&&benchmark.chart_verified&&Math.abs(Date.parse(stock.chart_at)-Date.parse(benchmark.chart_at))<DAY;
 const diff=k=>aligned&&finite(stock.metrics[k])&&finite(benchmark.metrics[k])?stock.metrics[k]-benchmark.metrics[k]:null;
 const values=Object.fromEntries(Object.keys(HORIZONS).map(k=>['rs_'+k.replace('return_',''),diff(k)]));
 return {...values,benchmark:benchmark.symbol,verified:!!(aligned&&finite(values.rs_1m)&&finite(values.rs_3m)),long_horizon_verified:!!(aligned&&finite(values.rs_6m)&&finite(values.rs_9m)&&finite(values.rs_12m)&&finite(values.rs_2y)),sources:[stock.source,benchmark.source],observed_at:stock.observed_at};
}
function ratesEvidence(csv,now=Date.now()){
 const lines=csv.trim().split(/\r?\n/),headers=lines.shift()?.split(',')||[];
 const required=['DGS2','DGS10','DGS30','DFII10','T10YIE'];const index=required.map(k=>headers.indexOf(k));
 const points=lines.map(line=>line.split(',')).filter(r=>index.every(i=>i>=0&&finite(r[i])&&r[i]!=='.')&&Date.parse(r[0])<=now).map(r=>({date:r[0],...Object.fromEntries(required.map((k,i)=>[k,Number(r[index[i]])]))}));
 const last=points.at(-1),prior=points.at(-6),fresh=last&&now-Date.parse(last.date)<=7*DAY;
 const deltas=last&&prior?Object.fromEntries(required.map(k=>[k,last[k]-prior[k]])):{};
 return {verified:!!(fresh&&prior),source:'https://fred.stlouisfed.org/graph/?id='+required.join(','),observed_at:new Date(now).toISOString(),date:last?.date,levels:last||{},changes_5_sessions:deltas,reason:!fresh?'금리 원자료 관측일 미확인':!prior?'5거래일 비교 자료 부족':`10년물 변화 ${deltas.DGS10.toFixed(2)}%p = 실질금리 ${deltas.DFII10.toFixed(2)}%p + BE ${deltas.T10YIE.toFixed(2)}%p (텀프리미엄 별도 미확인)`};
}
async function get(url,json=true){const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 GN-PIVOT/1.0',accept:json?'application/json':'text/csv'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('HTTP '+r.status);return json?r.json():r.text();}
function createVerificationService(fetcher=get,clock=Date.now){
 let cache={items:[],rates:null,ts:null,errors:[]},pending=null,lastAttempt=0;
 async function refresh(){if(pending)return pending;if(lastAttempt&&clock()-lastAttempt<300000)return;lastAttempt=clock();
  pending=(async()=>{const now=clock(),charts=new Map(),errors=[];await Promise.all([...new Set(SPECS.flatMap(([s,,b])=>[s,b]))].map(async symbol=>{try{charts.set(symbol,chartEvidence(await fetcher('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?interval=1d&range=3y'),symbol,now));}catch{errors.push(symbol+': 시세·차트 조회 실패');}}));
   let rates=null;try{rates=ratesEvidence(await fetcher('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS2,DGS10,DGS30,DFII10,T10YIE&cosd='+new Date(now-30*DAY).toISOString().slice(0,10),false),now);}catch{errors.push('FRED: 금리 원자료 조회 실패');}
   const items=SPECS.map(([symbol,kind,benchmark])=>{const c=charts.get(symbol),b=charts.get(benchmark);return c?{...c,kind,relative_strength:c&&b?relativeStrength(c,b):null}:{symbol,kind,price_verified:false,chart_verified:false,error:'제공처 조회 실패'};});cache={items,rates,ts:new Date(now).toISOString(),errors};
  })().finally(()=>{pending=null;});return pending;
 }
 function read(){void refresh().catch(()=>{});return cache;}
 function health(){return {running:!!pending,last_attempt:lastAttempt?new Date(lastAttempt).toISOString():null,observed_at:cache.ts,verified_prices:cache.items.filter(x=>x.price_verified).length,verified_charts:cache.items.filter(x=>x.chart_verified).length,verified_rates:!!cache.rates?.verified};}
 return {refresh,read,health};
}
let service;
function installVerification(app){service=createVerificationService();app.get('/api/gn-verification',(req,res)=>{res.set('Cache-Control','no-store');res.json(service.read());});void service.refresh().catch(()=>{});const timer=setInterval(()=>void service.refresh().catch(()=>{}),300000);timer.unref();return service;}
function verificationHealth(){return service?.health()||{};}
module.exports={chartEvidence,relativeStrength,ratesEvidence,createVerificationService,installVerification,verificationHealth};
