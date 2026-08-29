"use strict";
const expressPath=require.resolve("express");
const originalExpress=require("express");
const {createClient}=require("@supabase/supabase-js");
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

async function latestBatch(table,select="*"){
  const {data:one,error}=await db.from(table).select("ts").order("ts",{ascending:false}).limit(1).maybeSingle();
  if(error||!one?.ts)return [];
  const {data}=await db.from(table).select(select).eq("ts",one.ts).order("rank",{ascending:true});return data||[];
}
async function flowMap(req,res){
  try{
    const [{data:macro},{data:market},{data:runs},assets,sectors,reps]=await Promise.all([
      db.from("gn_macro_regime").select("*").order("ts",{ascending:false}).limit(1).maybeSingle(),
      db.from("gn_market_snapshots").select("*").order("ts",{ascending:false}).limit(1).maybeSingle(),
      db.from("gn_runs").select("started_at,status,source_status").order("started_at",{ascending:false}).limit(1).maybeSingle(),
      latestBatch("gn_asset_flow_scores"),latestBatch("gn_sector_flow_scores"),latestBatch("gn_representatives")
    ]);
    res.json({ts:new Date().toISOString(),macro:macro||null,market:market||null,lastRun:runs||null,assets,sectors,reps});
  }catch(e){res.status(500).json({error:String(e.message||e)});}
}

const BODY=`<body><div class="wrap">
<header><div><h1>GN PIVOT</h1><div class="muted" id="updated">돈의 발자국 불러오는 중...</div></div><div><button onclick="loadAll()">새로고침</button> <a href="/logout">로그아웃</a></div></header>
<section class="hero"><div class="eyebrow">1. 지금 돈은 어디로 가는가</div><div class="big" id="regime">확인 중</div><div id="flowline" class="flowline"></div><div id="health" class="health"></div></section>
<h2>2. 자산군 대표 선수</h2><div id="assets" class="assetgrid"></div>
<h2>3. 주식 - 돈이 들어가는 섹터</h2><div id="sectors" class="rows"></div>
<h2>4. 크립토 - 선행 탐지 -> 실제 진입 후보</h2><div class="twocol"><div><div class="label">시장 기준</div><div id="majors" class="mini"></div></div><div><div class="label">유효 TOP3</div><div id="top3" class="rows"></div></div></div>
<h2>5. 보유자산 관리</h2><div id="portfolio" class="rows"><div class="empty">불러오는 중...</div></div>
<div class="foot">뉴스보다 실제 자금 이동과 가격 반응을 우선합니다. 정책 -> 금리/달러 -> 기관/현물 -> 파생 -> 섹터 -> 종목 -> 가격반응.</div>
</div>
<script>
const nf=x=>x==null||!Number.isFinite(Number(x))?'--':Number(x).toLocaleString();
const pct=x=>x==null?'--':(Number(x)*100).toFixed(1)+'%';
async function safe(u){const r=await fetch(u);if(r.status===401){location.href='/login';throw Error('login');}if(!r.ok)throw Error(await r.text());return r.json();}
function state(s){s=String(s||'').toUpperCase();if(s.includes('ENTRY')||s.includes('LEADER')||s.includes('BUY'))return ['진입','good'];if(s.includes('NO_CHASE')||s.includes('DEFENSIVE')||s.includes('SELL')||s.includes('RISK_OFF'))return ['방어','bad'];if(s.includes('SCOUT'))return ['선발대','warn'];return ['관찰','neutral'];}
function assetCards(x){const wanted=['STOCK','CRYPTO','BOND','GOLD','COMMODITY','CASH'];const names={STOCK:'주식',CRYPTO:'크립토',BOND:'채권',GOLD:'금',COMMODITY:'원자재',CASH:'현금'};const map={};(x.assets||[]).forEach(a=>map[a.asset_class]=a);return wanted.map(k=>{const a=map[k]||{};const rep=(x.reps||[]).find(r=>r.asset_class===k);const st=state(a.action||rep?.action);return '<div class="asset"><div class="assetname">'+names[k]+'</div><div class="symbol">'+(rep?.symbol||'--')+'</div><div class="score">'+nf(a.components?.total_score||rep?.total_score)+'</div><div class="'+st[1]+'">'+st[0]+'</div></div>'}).join('');}
function sectorRows(x){const rows=(x.reps||[]).filter(r=>r.asset_class==='STOCK_SECTOR').sort((a,b)=>(b.total_score||0)-(a.total_score||0)).slice(0,6);if(!rows.length)return '<div class="empty">섹터 데이터 대기</div>';return rows.map((r,i)=>'<div class="row"><b>'+(i+1)+'. '+String(r.sector||'').replaceAll('_',' ')+'</b><span>'+r.symbol+'</span><span>'+nf(r.price)+'</span><strong>'+nf(r.total_score)+'</strong></div>').join('');}
function majors(rows){const by={};(rows||[]).forEach(r=>by[String(r.coin||'').toUpperCase()]=r);return ['BTC','ETH','SOL'].map(k=>{const r=by[k]||{};return '<div class="major"><b>'+k+'</b><span>'+nf(r.krw_price)+'원</span><span>'+String(r.stage||'확인중')+'</span></div>'}).join('');}
function top3(rows){const valid=(rows||[]).filter(r=>['ENTRY','SCOUT'].includes(String(r.status||'').toUpperCase())).slice(0,3);if(!valid.length)return '<div class="empty">현재 유효 진입 후보 없음</div>';return valid.map((r,i)=>{const d=r.details||{};const lo=r.recommended_entry_low,hi=r.recommended_entry_high;return '<div class="pick"><div><b>'+(i+1)+'. '+String(r.market||'').replace('KRW-','')+'</b><small>최초 '+nf(r.first_detected_price)+' -> 현재 '+nf(r.krw_price)+'</small></div><div><b>'+String(r.status)+'</b><small>진입 '+nf(lo)+'~'+nf(hi)+'</small></div><div class="tf">4H '+(d?.timeframes?.h4?.pass?'O':'-')+' · D1 '+(d?.timeframes?.d1?.pass?'O':'-')+' · W1 '+(d?.timeframes?.w1?.pass?'O':'-')+'</div></div>'}).join('');}
function portfolioRows(p){const rows=Array.isArray(p)?p:(p?.assets||p?.positions||[]);if(!rows?.length)return '<div class="empty">연결된 보유 데이터 없음</div>';return rows.slice(0,8).map(r=>'<div class="row"><b>'+String(r.symbol||r.market||r.coin||'')+'</b><span>'+nf(r.price||r.krw_price)+'</span><span>'+String(r.action||r.status||'보유')+'</span><strong>'+nf(r.pnl_pct||r.return_pct)+'</strong></div>').join('');}
async function loadAll(){try{const [x,latest,pre,p]=await Promise.all([safe('/api/flow-map'),safe('/api/latest'),safe('/api/pre-pump/latest').catch(()=>[]),safe('/api/portfolio').catch(()=>[])]);const m=x.macro||{},mk=x.market||{};document.getElementById('regime').textContent=(m.regime||mk.regime||'MIXED')+' · '+nf(m.macro_score||mk.market_score);document.getElementById('flowline').textContent='정책/금리/달러 -> 자산군 -> 섹터 -> 종목 -> 진입';const age=x.lastRun?.started_at?Math.round((Date.now()-new Date(x.lastRun.started_at))/60000):null;document.getElementById('health').textContent='데이터 '+(age!=null?age+'분 전':'확인중')+' · '+(x.lastRun?.status||'--');document.getElementById('assets').innerHTML=assetCards(x);document.getElementById('sectors').innerHTML=sectorRows(x);document.getElementById('majors').innerHTML=majors(latest);document.getElementById('top3').innerHTML=top3(pre);document.getElementById('portfolio').innerHTML=portfolioRows(p);document.getElementById('updated').textContent='최종 갱신 '+new Date().toLocaleString()+' · 60초 자동';}catch(e){document.getElementById('updated').textContent='데이터 오류 - 신규진입 금지';}}
loadAll();setInterval(loadAll,60000);
</script></body>`;
const STYLE=`<style id="gn-final-style">:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#080a0d;color:#eef2f6;font-family:system-ui,-apple-system,sans-serif}.wrap{max-width:920px;margin:auto;padding:14px 14px 42px}header{display:flex;justify-content:space-between;align-items:center;gap:12px}h1{margin:4px 0;font-size:24px}h2{font-size:15px;margin:20px 2px 8px}.muted,.label,.foot{color:#8f9ba7;font-size:12px}button,a{background:#18202a;color:#eef2f6;border:1px solid #33404d;border-radius:9px;padding:8px 10px;text-decoration:none}.hero,.asset,.row,.pick,.major,.empty{background:#12171d;border:1px solid #27313b;border-radius:14px}.hero{padding:16px;margin-top:12px}.eyebrow{color:#99a5b1;font-size:12px}.big{font-size:30px;font-weight:950;margin:4px 0}.flowline{font-size:14px;font-weight:750;margin-top:8px}.health{font-size:12px;color:#99a5b1;margin-top:7px}.assetgrid{display:grid;grid-template-columns:repeat(6,1fr);gap:7px}.asset{padding:11px;min-width:0}.assetname{font-size:11px;color:#99a5b1}.symbol{font-size:17px;font-weight:900;margin:4px 0}.score{font-size:12px}.good{color:#55d98b}.warn{color:#ffd166}.bad{color:#ff6b6b}.neutral{color:#aeb8c2}.rows{display:grid;gap:6px}.row{display:grid;grid-template-columns:1.6fr .8fr 1fr .6fr;gap:8px;padding:10px;align-items:center;font-size:13px}.row strong{text-align:right}.twocol{display:grid;grid-template-columns:.8fr 1.2fr;gap:10px}.mini{display:grid;gap:6px}.major{display:grid;grid-template-columns:.5fr 1fr 1fr;padding:10px;font-size:13px}.pick{display:grid;grid-template-columns:1.3fr 1fr .8fr;gap:10px;padding:10px;font-size:13px}.pick small{display:block;color:#99a5b1;margin-top:3px}.tf{text-align:right;font-size:12px;color:#c5ced7}.empty{padding:14px;color:#99a5b1}.foot{text-align:center;margin-top:22px}@media(max-width:720px){.assetgrid{grid-template-columns:repeat(3,1fr)}.twocol{grid-template-columns:1fr}.pick{grid-template-columns:1.2fr 1fr}.tf{grid-column:1/-1;text-align:left}.row{grid-template-columns:1.3fr .8fr 1fr}.row strong{display:none}}@media(max-width:420px){.assetgrid{grid-template-columns:repeat(2,1fr)}.big{font-size:25px}}</style>`;
function patchHtml(html){if(typeof html!=="string"||!html.includes('id="hero"')||html.includes('gn-final-style'))return html;html=html.replace('</head>',STYLE+'</head>');return html.replace(/<body>[\s\S]*<\/body>/,BODY);}
function wrappedExpress(...args){const app=originalExpress(...args);app.use((req,res,next)=>{if(req.path==="/api/flow-map")return flowMap(req,res);const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body));};next();});return app;}
Object.assign(wrappedExpress,originalExpress);require.cache[expressPath].exports=wrappedExpress;
