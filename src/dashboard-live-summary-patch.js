"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");
const {createClient}=require("@supabase/supabase-js");
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const KR={MNDY:"먼데이닷컴",NOW:"서비스나우",CRWD:"크라우드스트라이크",DDOG:"데이터독",GLD:"금",DBC:"원자재",TLT:"미국장기채",BIL:"현금성"};
const AI_SOFTWARE=[
 {symbol:"MNDY",name:"먼데이닷컴",basis:"AI 기능 확장 + 좌석/사용 확장에 따른 매출 레버리지"},
 {symbol:"NOW",name:"서비스나우",basis:"Now Assist/AI 제품의 별도 계약·ACV 추적 가능"},
 {symbol:"CRWD",name:"크라우드스트라이크",basis:"Falcon 모듈·AI 보안 사용 확대가 구독 확장으로 연결"},
 {symbol:"DDOG",name:"데이터독",basis:"사용량 기반 클라우드 관측 매출 + AI 워크로드 수혜"}
];
const timeout=(p,ms=5000)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error("TIMEOUT")),ms))]);
async function latestPerKey(table,keyFn,limit=600){
 const {data,error}=await timeout(db.from(table).select("*").order("ts",{ascending:false}).limit(limit),5000);
 if(error)throw error;const seen=new Set(),out=[];for(const row of data||[]){const key=keyFn(row);if(!key||seen.has(key))continue;seen.add(key);out.push(row);}return out;
}
async function usQuote(item){const c=new AbortController(),timer=setTimeout(()=>c.abort(),3500);try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${item.symbol}?interval=1m&range=1d`,{headers:{"user-agent":"Mozilla/5.0 GN-PIVOT/1.0","accept":"application/json"},signal:c.signal});if(!r.ok)throw Error(`HTTP ${r.status}`);const p=await r.json(),m=p?.chart?.result?.[0]?.meta||{},price=Number(m.regularMarketPrice);return {...item,price:Number.isFinite(price)?price:null,tradedAt:m.regularMarketTime?new Date(m.regularMarketTime*1000).toISOString():null,source:"YAHOO_FINANCE_CHART"};}catch(e){return {...item,price:null,tradedAt:null,source:"UNAVAILABLE",error:String(e?.name==="AbortError"?"QUOTE_TIMEOUT":e?.message||e)}}finally{clearTimeout(timer)}}
function val(r,fallback){return r.status==="fulfilled"?r.value:fallback}
function aiFreshness(consensus,analyses){const ts=consensus?.created_at||analyses?.[0]?.created_at||null;const ageHours=ts?Math.max(0,(Date.now()-new Date(ts).getTime())/3600000):null;const fresh=ageHours!=null&&ageHours<=2;return {ts,ageHours,fresh};}
function providerSummary(rows){const seen=new Set(),out=[];for(const r of rows||[]){if(!r?.provider||seen.has(r.provider))continue;seen.add(r.provider);out.push({provider:r.provider,status:r.status,sentiment:r.sentiment,confidence:r.confidence,summary:r.summary,source_snapshot_ts:r.source_snapshot_ts,created_at:r.created_at,error_code:r.error_code});if(out.length===5)break;}return out;}
async function liveSummary(req,res){
 const warnings=[];
 try{
   const cutoff=new Date(Date.now()-30*60*1000).toISOString();
   const settled=await Promise.allSettled([
     latestPerKey("gn_representatives",r=>r?.sector?`${r.asset_class||"UNKNOWN"}:${r.sector}`:(r?.asset_class||null),800),
     latestPerKey("gn_asset_flow_scores",r=>r?.asset_class||null,240),
     latestPerKey("gn_sector_flow_scores",r=>`${r?.asset_class||"STOCK"}:${r?.sector||""}`,800),
     timeout(db.from("gn_pre_pump_snapshots").select("*").gte("ts",cutoff).order("score",{ascending:false}).limit(100),5000),
     timeout(db.from("gn_ai_consensus").select("created_at,source_snapshot_ts,verdict,all_five_ok,providers_success,evidence_quality,conflict_count").order("created_at",{ascending:false}).limit(1).maybeSingle(),5000),
     timeout(db.from("gn_ai_analyses").select("created_at,source_snapshot_ts,provider,model,status,summary,sentiment,confidence,signals,error_code").order("created_at",{ascending:false}).limit(25),5000),
     timeout(db.from("gn_market_snapshots").select("ts,market_score,action,regime,quality,spot_breadth100,spot_breadth50,spot_median100,spot_vw100,btc_taker_ratio,eth_taker_ratio,reasons").order("ts",{ascending:false}).limit(1).maybeSingle(),5000),
     timeout(db.from("gn_macro_regime").select("ts,regime,macro_score,liquidity_score,rates_score,usd_fx_score,commodities_score,volatility_score,data_quality").order("ts",{ascending:false}).limit(1).maybeSingle(),5000),
     Promise.all(AI_SOFTWARE.map(usQuote))
   ]);
   settled.forEach((r,i)=>{if(r.status==="rejected")warnings.push(`source_${i}:${String(r.reason?.message||r.reason)}`)});
   const reps=val(settled[0],[]),assets=val(settled[1],[]),sectors=val(settled[2],[]),cryptoR=val(settled[3],{data:[]}),consR=val(settled[4],{data:null}),analR=val(settled[5],{data:[]}),marketR=val(settled[6],{data:null}),macroR=val(settled[7],{data:null}),aiSoftware=val(settled[8],AI_SOFTWARE.map(x=>({...x,price:null,source:"UNAVAILABLE"})));
   [cryptoR,consR,analR,marketR,macroR].forEach((x,i)=>{if(x?.error)warnings.push(`db_${i}:${x.error.message}`)});
   const seen=new Set(),radar=[];for(const row of cryptoR?.data||[]){if(!row?.market||seen.has(row.market))continue;seen.add(row.market);radar.push(row);if(radar.length===3)break;}
   assets.sort((a,b)=>(Number(a.rank)||99)-(Number(b.rank)||99));sectors.sort((a,b)=>(Number(a.rank)||99)-(Number(b.rank)||99));
   const providers=providerSummary(analR?.data||[]),freshness=aiFreshness(consR?.data,providers);
   const consensus={...(consR?.data||{}),fresh:freshness.fresh,age_hours:freshness.ageHours,latest_at:freshness.ts,providers,usable_for_entry:!!(freshness.fresh&&consR?.data?.all_five_ok)};
   const market=marketR?.data||null,macro=macroR?.data||null;
   const primary=(assets||[])[0]||null;
   const simpleDecision=market?.market_score>=65&&market?.spot_breadth100>=0.6?"관찰 우위":market?.market_score<50?"하락대비":"관찰 유지";
   res.set("Cache-Control","no-store");
   return res.json({ts:new Date().toISOString(),reps,assets,sectors,cryptoRadar:radar,consensus,market,macro,primaryAsset:primary,simpleDecision,kr:KR,aiSoftware,aiSoftwareRankVerified:false,degraded:warnings.length>0,warnings});
 }catch(e){res.set("Cache-Control","no-store");return res.status(200).json({ts:new Date().toISOString(),reps:[],assets:[],sectors:[],cryptoRadar:[],consensus:{fresh:false,usable_for_entry:false,providers:[]},market:null,macro:null,primaryAsset:null,simpleDecision:"데이터 재연결",kr:KR,aiSoftware:AI_SOFTWARE.map(x=>({...x,price:null,source:"UNAVAILABLE"})),degraded:true,warnings:[`live_summary:${String(e?.message||e)}`]});}
}
const SCRIPT=`<script id="gn-live-summary-v9">(function(){async function load(){try{var r=await fetch('/api/live-summary?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);var d=await r.json();var u=document.getElementById('updated');if(u)u.textContent=(d.degraded?'부분 데이터 · ':'실시간 검증 · ')+new Date(d.ts).toLocaleTimeString()+' · 15초 자동';}catch(e){var u=document.getElementById('updated');if(u)u.textContent='라이브 재조회 중 · '+new Date().toLocaleTimeString()}}setTimeout(load,300);setInterval(load,15000);window.gnLiveSummary=load;})();</script>`;
function patchHtml(html){if(typeof html!=="string"||!html.includes("<title>GN PIVOT</title>")||html.includes("gn-live-summary-v9"))return html;return html.replace("</body>",SCRIPT+"</body>");}
function wrappedExpress(...args){const app=previousExpress(...args);app.get("/api/live-summary",liveSummary);app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});return app;}
Object.assign(wrappedExpress,previousExpress);require.cache[expressPath].exports=wrappedExpress;
