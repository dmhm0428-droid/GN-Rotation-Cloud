"use strict";
const WATCH=['IREN','AVGO','VRT','MNDY','GEV','000660.KS','010120.KS','267260.KS'];
const CIK={IREN:'0001878848',AVGO:'0001730168',VRT:'0001674101',MNDY:'0001845338',GEV:'0001996810'};
const number=v=>{const x=v&&typeof v==='object'?v.raw:v;return x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x):null;};
const day=86400000;
function evidence(status,reason,sources,now,extra={}){return {status,reason,sources,verified:status!=='UNKNOWN',observed_at:new Date(now).toISOString(),valid_until:new Date(now+day).toISOString(),...extra};}
function unknown(reason,now){return evidence('UNKNOWN',reason,[],now);}
// Match identical fiscal periods; never compare quarterly/YTD cash against a full year.
function cashFromFacts(json,source,now=Date.now()){
 const facts=json?.facts?.['us-gaap']||{};
 function factsFor(tag){const map=new Map();for(const x of facts[tag]?.units?.USD||[]){if(!['10-K','10-Q'].includes(x.form)||!x.start||!x.end||Date.parse(x.filed)>now||number(x.val)===null)continue;const k=x.start+'/'+x.end,p=map.get(k);if(!p||x.filed>p.filed)map.set(k,x);}return [...map.values()];}
 const ocf=factsFor('NetCashProvidedByUsedInOperatingActivities');
 const latest=ocf.sort((a,b)=>b.end.localeCompare(a.end)||b.start.localeCompare(a.start))[0];
 if(!latest)return unknown('공시 영업현금흐름 없음',now);
 const shift=(s,n)=>String(Number(s.slice(0,4))+n)+s.slice(4);
 function ttm(tag,start,end){const arr=factsFor(tag),get=(s,e)=>arr.find(x=>x.start===s&&x.end===e);const span=(Date.parse(end)-Date.parse(start))/day;
  if(span>=330&&span<=380)return number(get(start,end)?.val);
  const y=Number(start.slice(0,4));if(start!==y+'-01-01')return null;
  const annual=get((y-1)+'-01-01',(y-1)+'-12-31'),current=get(start,end),prior=get(shift(start,-1),shift(end,-1));
  return [annual,current,prior].every(x=>x)?annual.val+current.val-prior.val:null;
 }
 const current=ttm('NetCashProvidedByUsedInOperatingActivities',latest.start,latest.end),prior=ttm('NetCashProvidedByUsedInOperatingActivities',shift(latest.start,-1),shift(latest.end,-1));
 const capex=ttm('PaymentsToAcquirePropertyPlantAndEquipment',latest.start,latest.end),sbc=ttm('ShareBasedCompensation',latest.start,latest.end);
 const metrics={currency:'USD',period_end:latest.end,filed_at:latest.filed,ocf_ttm:current,ocf_prior_ttm:prior,capex_ttm:capex,fcf_ttm:current!==null&&capex!==null?current-capex:null,sbc_ttm:sbc};
 const stale=now-Date.parse(latest.end)>200*day;
 const usable=!stale&&current!==null&&prior!==null&&capex!==null&&sbc!==null;
 const improved=usable&&current>prior&&current>0&&current-capex>0;
 return evidence(!usable?'UNKNOWN':improved?'PASS':'FAIL',stale?'공시기간이 오래되어 재확인 필요':!usable?'TTM·전년 비교 또는 CAPEX·주식보상 자료 부족':`영업현금흐름 TTM ${current.toLocaleString()} / 전년 ${prior.toLocaleString()} USD · FCF ${(current-capex).toLocaleString()} USD · 운전자본 상세 검토 필요`,[source],now,{metrics});
}
function estimatesFromTrend(trend,source,now=Date.now()){
 const rows=(trend||[]).filter(x=>['0q','+1q','0y','+1y'].includes(x.period)).map(x=>({period:x.period,end_date:x.endDate,eps:number(x.epsTrend?.current),eps_30d:number(x.epsTrend?.['30daysAgo']),eps_90d:number(x.epsTrend?.['90daysAgo']),analysts:number(x.earningsEstimate?.numberOfAnalysts)}));
 const quarter=rows.find(x=>x.period==='+1q'),year=rows.find(x=>x.period==='+1y');
 const ready=[quarter,year].every(x=>x&&x.analysts>0&&[x.eps,x.eps_30d,x.eps_90d].every(v=>v!==null)&&Date.parse(x.end_date)>now)&&Date.parse(quarter.end_date)-now<=120*day;
 const raised=ready&&[quarter,year].every(x=>x.eps>x.eps_30d&&x.eps>x.eps_90d);
 // Annual consensus is not a rolling 12-month estimate: retain that distinction.
 return evidence(!ready?'UNKNOWN':raised?'PASS':'FAIL',!ready?'동일 전망기간의 현재·30일·90일 EPS 자료 부족':raised?'다음 분기·다음 회계연도 EPS 모두 30일·90일 전보다 상향':'다음 분기·회계연도 EPS 상향 조건 미충족',[source],now,{metrics:{forecasts:rows,annual_basis:'NEXT_FISCAL_YEAR_NOT_ROLLING_NTM'}});
}
async function json(url,headers={}){const r=await fetch(url,{headers:{'user-agent':url.startsWith('https://data.sec.gov/')?'GN-PIVOT/1.0 (+https://gn-rotation-cloud-8b0z.onrender.com)':'Mozilla/5.0 GN-PIVOT/1.0',...headers},signal:AbortSignal.timeout(url.startsWith('https://data.sec.gov/')?25000:20000)});if(!r.ok)throw Error('HTTP '+r.status);return r.json();}
function cashFromTimeseries(data,source,now=Date.now()){
 const series={};for(const row of data?.timeseries?.result||[]){for(const tag of ['quarterlyOperatingCashFlow','quarterlyCapitalExpenditure','quarterlyStockBasedCompensation'])if(Array.isArray(row[tag]))series[tag]=row[tag].filter(x=>x.currencyCode==='KRW'&&number(x.reportedValue)!==null&&Date.parse(x.asOfDate)<=now).sort((a,b)=>b.asOfDate.localeCompare(a.asOfDate));}
 const ocf=[...new Map((series.quarterlyOperatingCashFlow||[]).map(x=>[x.asOfDate,x])).values()];
 const dates=ocf.slice(0,8).map(x=>x.asOfDate);
 const complete=dates.length===8&&dates.every((d,i)=>i===0||Date.parse(dates[i-1])-Date.parse(d)>60*day&&Date.parse(dates[i-1])-Date.parse(d)<120*day);
 const sum=(tag,offset)=>{const points=dates.slice(offset,offset+4).map(d=>series[tag]?.find(x=>x.asOfDate===d));return complete&&points.every(Boolean)?points.reduce((n,x)=>n+number(x.reportedValue),0):null;};
 const current=sum('quarterlyOperatingCashFlow',0),prior=sum('quarterlyOperatingCashFlow',4),capex=sum('quarterlyCapitalExpenditure',0),sbc=sum('quarterlyStockBasedCompensation',0);
 const metrics={currency:'KRW',period_end:dates[0],ocf_ttm:current,ocf_prior_ttm:prior,capex_ttm:capex!==null?Math.abs(capex):null,fcf_ttm:current!==null&&capex!==null?current-Math.abs(capex):null,sbc_ttm:sbc};
 // Aggregated data needs a filing cross-check, not an automatic primary-source pass.
 return evidence('UNKNOWN',current===null?'국내 분기 현금흐름 8개 비교 자료 부족':'국내 현금흐름 비교 수집 · 원공시·운전자본 대조 필요',[source],now,{metrics});
}
let yahooSession,yahooSessionAt=0;
async function yahooTrend(symbol){
 if(yahooSession&&Date.now()-yahooSessionAt>30*60000)yahooSession=null;
 if(!yahooSession)yahooSessionAt=Date.now();
 if(!yahooSession)yahooSession=(async()=>{const r=await fetch('https://fc.yahoo.com',{headers:{'user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20000)});const cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');const c=await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb',{headers:{cookie,'user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20000)});if(!c.ok)throw Error('EPS_SESSION_HTTP_'+c.status);const crumb=await c.text();return {cookie,crumb};})().catch(e=>{yahooSession=null;throw e;});
 const {cookie,crumb}=await yahooSession;
 const u='https://query2.finance.yahoo.com/v10/finance/quoteSummary/'+encodeURIComponent(symbol)+'?modules=earningsTrend&crumb='+encodeURIComponent(crumb);
 const data=await json(u,{cookie,'user-agent':'Mozilla/5.0'});const trend=data?.quoteSummary?.result?.[0]?.earningsTrend?.trend;
 if(!Array.isArray(trend))throw Error('EPS_TREND_UNAVAILABLE');return trend;
}
async function collectSymbol(symbol,now=Date.now(),ciks=CIK){
 const checks={estimates:unknown('EPS 조회 대기',now),cashflow:unknown('국내 공시 현금흐름 수집원 미연결',now)};const errors=[];
 await Promise.all([
  (async()=>{try{checks.estimates=estimatesFromTrend(await yahooTrend(symbol),'https://finance.yahoo.com/quote/'+symbol+'/analysis/',now);}catch(e){yahooSession=null;const code=/^HTTP [0-9]{3}$/.test(e.message)?'EPS_HTTP_'+e.message.slice(-3):/^EPS_SESSION_HTTP_[0-9]{3}$/.test(e.message)?e.message:['TimeoutError','AbortError'].includes(e.name)?'EPS_TIMEOUT':e.message==='EPS_TREND_UNAVAILABLE'?'EPS_TREND_UNAVAILABLE':'EPS_CONNECTION_FAILED';checks.estimates=unknown('EPS 제공처 조회 실패 ('+code+') · 5분 후 재조회',now);errors.push(code);}})(),
  (async()=>{if(!ciks[symbol]){if(!/\.K[QS]$/.test(symbol)){checks.cashflow=unknown('미국 상장 기업의 원공시 식별정보 미연결',now);return;}const u='https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/'+encodeURIComponent(symbol)+'?type=quarterlyOperatingCashFlow,quarterlyCapitalExpenditure,quarterlyStockBasedCompensation&period1='+Math.floor((now-3*365*day)/1000)+'&period2='+Math.floor(now/1000);try{checks.cashflow=cashFromTimeseries(await json(u),'https://finance.yahoo.com/quote/'+symbol+'/cash-flow/',now);}catch{checks.cashflow=unknown('국내 현금흐름 제공처 접근 실패 · 자동 재조회 예정',now);errors.push('KR_CASHFLOW_UNAVAILABLE');}return;}const u='https://data.sec.gov/api/xbrl/companyfacts/CIK'+ciks[symbol]+'.json';try{checks.cashflow=cashFromFacts(await json(u),u,now);}catch{checks.cashflow=unknown('SEC 공시 조회 실패 · 자동 재조회 예정',now);errors.push('SEC_UNAVAILABLE');}})()
 ]);
 return {symbol,observed_at:new Date(now).toISOString(),checks,errors};
}
function verifiedSnapshotEstimates(snapshot,symbol,now=Date.now()){
 if(snapshot?.schema_version!==1||snapshot?.collection_path!=='GITHUB_ACTIONS_PUBLIC_SOURCE')return null;
 const row=snapshot.items?.find(x=>x.symbol===symbol),e=row?.checks?.estimates;
 const date=Date.parse(row?.observed_at),source='https://finance.yahoo.com/quote/'+symbol+'/analysis/';
 if(!Number.isFinite(date)||date>now+300000||now-date>2*3600000||e?.verified!==true||!['PASS','FAIL'].includes(e.status)||!e.sources?.includes(source))return null;
 // Recompute the fixed EPS rule from raw dated observations instead of trusting a stored PASS.
 const trend=(e.metrics?.forecasts||[]).map(x=>({period:x.period,endDate:x.end_date,epsTrend:{current:x.eps,'30daysAgo':x.eps_30d,'90daysAgo':x.eps_90d},earningsEstimate:{numberOfAnalysts:x.analysts}}));
 const computed=estimatesFromTrend(trend,source,date);if(!computed.verified)return null;
 return {...computed,collection_path:'GITHUB_ACTIONS_PUBLIC_SOURCE',retrieved_at:new Date(now).toISOString()};
}
async function snapshotFallback(symbol,now){
 const u='https://raw.githubusercontent.com/dmhm0428-droid/GN-Rotation-Cloud/gn-verified-data/gn-fundamentals.json';
 try{return verifiedSnapshotEstimates(await json(u),symbol,now);}catch{return null;}
}
function createFundamentalService(db,collector=collectSymbol,clock=Date.now){
 const cache=new Map();let pending=null,lastRun=0,storageRetry=0,storageStatus='CONNECTING',lastRead=0;
 async function refresh(){if(pending)return pending;const retryInterval=[...cache.values()].some(x=>x.errors?.length)?300000:3600000;if(lastRun&&clock()-lastRun<retryInterval)return;lastRun=clock();
  pending=(async()=>{await Promise.all(WATCH.map(async symbol=>{const payload=await collector(symbol,clock());if(payload.errors?.some(x=>x.startsWith('EPS_'))){const fallback=await snapshotFallback(symbol,clock());if(fallback){payload.checks.estimates=fallback;payload.errors=payload.errors.filter(x=>!x.startsWith('EPS_'));}}cache.set(symbol,payload);if(clock()<storageRetry)return;try{const {error}=await db.from('gn_fundamental_snapshots').insert({symbol,observed_at:payload.observed_at,payload});if(error)throw error;storageStatus='AVAILABLE';}catch{storageStatus='UNAVAILABLE';storageRetry=clock()+3600000;}}));})().finally(()=>{pending=null;});return pending;
 }
 async function read(){if(clock()>=storageRetry&&clock()-lastRead>=300000){lastRead=clock();try{const {data,error}=await db.from('gn_fundamental_snapshots').select('symbol,observed_at,payload').in('symbol',WATCH).order('observed_at',{ascending:false}).limit(24);if(error)throw error;const seen=new Set();for(const x of data||[]){if(seen.has(x.symbol))continue;seen.add(x.symbol);const p=cache.get(x.symbol);if(!p||Date.parse(x.observed_at)>Date.parse(p.observed_at))cache.set(x.symbol,x.payload);}storageStatus='AVAILABLE';}catch{storageStatus='UNAVAILABLE';storageRetry=clock()+3600000;}}
  void refresh().catch(()=>{});return {items:[...cache.values()],ts:new Date(clock()).toISOString(),storage_status:storageStatus,mode:'DIRECT_PROVIDER_CACHE',refresh_interval_minutes:[...cache.values()].some(x=>x.errors?.length)?5:60};
 }
 function health(){return {storage_status:storageStatus,running:!!pending,last_attempt:lastRun?new Date(lastRun).toISOString():null,collected_symbols:cache.size,provider_errors:[...new Set([...cache.values()].flatMap(x=>x.errors||[]))],eps_statuses:[...cache.values()].reduce((a,x)=>{const k=x.checks.estimates?.status||'UNKNOWN';a[k]=(a[k]||0)+1;return a;},{}),verified_eps:[...cache.values()].filter(x=>x.checks.estimates?.verified===true&&['PASS','FAIL'].includes(x.checks.estimates?.status)).length,verified_cashflow:[...cache.values()].filter(x=>x.checks.cashflow?.sources?.length&&x.checks.cashflow?.metrics?.ocf_ttm!==null&&x.checks.cashflow?.metrics?.ocf_ttm!==undefined).length};}
 return {refresh,read,health};
}
let installedService;
function installFundamentals(app,db){
 const service=createFundamentalService(db);installedService=service;
 app.get('/api/gn-fundamentals',async(req,res)=>{res.set('Cache-Control','no-store');res.json(await service.read());});
 const timer=setInterval(()=>{void service.refresh().catch(()=>{});},300000);timer.unref();void service.refresh().catch(()=>{});
 return service;
}
function fundamentalHealth(){return installedService?.health()||{running:false,collected_symbols:0};}
module.exports={verifiedSnapshotEstimates,cashFromFacts,cashFromTimeseries,estimatesFromTrend,collectSymbol,installFundamentals,createFundamentalService,fundamentalHealth};
