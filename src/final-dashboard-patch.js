"use strict";
const expressPath=require.resolve("express");
const originalExpress=require("express");
const {createClient}=require("@supabase/supabase-js");
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

async function latestBatch(table,select="*"){
  const {data:one,error}=await db.from(table).select("ts").order("ts",{ascending:false}).limit(1).maybeSingle();
  if(error||!one?.ts)return [];
  const q=db.from(table).select(select).eq("ts",one.ts);
  const {data}=table==="gn_representatives"?await q:await q.order("rank",{ascending:true});
  return data||[];
}
async function latestCryptoTop(){
  const {data:run}=await db.from("gn_runs").select("id,started_at,status,source_status").order("started_at",{ascending:false}).limit(1).maybeSingle();
  if(!run?.id)return {run:null,rows:[]};
  const {data}=await db.from("gn_pre_pump_snapshots").select("*").eq("run_id",run.id).in("rank",[1,2,3]).order("rank",{ascending:true});
  return {run,rows:data||[]};
}
async function flowMap(req,res){
  try{
    const [{data:macro},{data:market},assets,sectors,reps,crypto]=await Promise.all([
      db.from("gn_macro_regime").select("*").order("ts",{ascending:false}).limit(1).maybeSingle(),
      db.from("gn_market_snapshots").select("*").order("ts",{ascending:false}).limit(1).maybeSingle(),
      latestBatch("gn_asset_flow_scores"),latestBatch("gn_sector_flow_scores"),latestBatch("gn_representatives"),latestCryptoTop()
    ]);
    res.json({ts:new Date().toISOString(),macro:macro||null,market:market||null,lastRun:crypto.run||null,assets,sectors,reps,cryptoTop:crypto.rows});
  }catch(e){res.status(500).json({error:String(e.message||e)});}
}

const BODY=`<body><div class="wrap">
<header><div><h1>GN PIVOT</h1><div class="muted" id="updated">투자판정 불러오는 중...</div></div><div><button onclick="loadAll()">새로고침</button> <a href="/logout">로그아웃</a></div></header>

<section class="decisionHero" id="decisionHero"><div class="heroLabel">지금 해야 할 일</div><div class="heroAction neutral">확인 중</div><div class="heroReason">시장 전체 자금흐름 계산 중</div></section>

<section class="priority" id="priority"><div class="sectionTitle">오늘의 대표 선수</div><div id="leaders" class="leaderGrid"></div></section>

<section class="cryptoFocus"><div class="sectionHead"><div><div class="sectionTitle">크립토 TOP3 레이더</div><div class="sub">글로벌 자금 → 온체인 → 파생 → 기술구조 → 업비트 실행</div></div><div class="pill" id="cryptoState">검증 중</div></div><div id="top3" class="top3"></div></section>

<section><div class="sectionHead"><div><div class="sectionTitle">주식 섹터 상대강도</div><div class="sub">강한 섹터 안에서 가격반영이 덜 된 대표주 우선</div></div></div><div id="sectors" class="sectorGrid"></div></section>

<section><div class="sectionTitle">보유자산 행동판정</div><div id="portfolio" class="rows"><div class="empty">불러오는 중...</div></div></section>

<details class="diagnostics"><summary>시스템 진단 · 세부 데이터</summary><div id="diag" class="diag"></div></details>
<div class="foot">첫 화면은 행동판정만 표시합니다. API·오류·세부 점수는 진단 영역으로 분리합니다.</div>
</div>
<script>
const nf=x=>x==null||!Number.isFinite(Number(x))?'--':Number(x).toLocaleString();
const f1=x=>x==null||!Number.isFinite(Number(x))?'--':Number(x).toFixed(1);
const pct=x=>x==null||!Number.isFinite(Number(x))?'--':(Number(x)*100).toFixed(1)+'%';
async function safe(u){const r=await fetch(u);if(r.status===401){location.href='/login';throw Error('login');}if(!r.ok)throw Error(await r.text());return r.json();}
function state(raw,score){const s=String(raw||'').toUpperCase(),v=Number(score);if(s.includes('NO_CHASE')||s.includes('SELL')||s.includes('EXIT'))return ['추격금지','bad'];if(s.includes('ENTRY')||s.includes('BUY')||s.includes('LEADER'))return ['진입 가능','good'];if(s.includes('SCOUT'))return ['선발대','warn'];if(s.includes('DEFENSIVE'))return ['방어','bad'];if(Number.isFinite(v)&&v>=65)return ['우위','good'];if(Number.isFinite(v)&&v>=50)return ['관찰','warn'];return ['대기','neutral'];}
function mainDecision(x){const m=x.macro||{},assets=x.assets||[];const ranked=[...assets].sort((a,b)=>(a.rank||99)-(b.rank||99));const lead=ranked[0];const crypto=x.cryptoTop||[];const entry=crypto.find(r=>String(r.status).toUpperCase()==='ENTRY');let action='관찰 유지',cls='warn',reason='대표 자산군 '+(lead?.asset_class||'확인 중')+' · 매크로 '+(m.regime||'MIXED')+' '+f1(m.macro_score);if(entry){action='크립토 진입 후보 있음';cls='good';reason=String(entry.market||'').replace('KRW-','')+' · 8단계 검증 통과';}else if(String(m.regime||'').toUpperCase()==='RISK_OFF'){action='방어 우선';cls='bad';reason='위험회피 레짐 · 신규 추격 금지 · 상대강도 1위만 관찰';}return '<div class="heroLabel">지금 해야 할 일</div><div class="heroAction '+cls+'">'+action+'</div><div class="heroReason">'+reason+'</div>';}
function leaderCards(x){const wanted=['STOCK','CRYPTO','BOND','GOLD','COMMODITY','CASH'];const names={STOCK:'주식',CRYPTO:'크립토',BOND:'채권',GOLD:'금',COMMODITY:'원자재',CASH:'현금'};const amap={};(x.assets||[]).forEach(a=>amap[a.asset_class]=a);return wanted.map(k=>{const a=amap[k]||{};const rep=(x.reps||[]).filter(r=>r.asset_class===k).sort((u,v)=>new Date(v.ts)-new Date(u.ts))[0];const sc=a.components?.total_score??rep?.total_score??a.flow_score;const st=state(a.action||rep?.action,sc);return '<div class="leader"><div class="leaderTop"><span>'+names[k]+'</span><b class="'+st[1]+'">'+st[0]+'</b></div><div class="leaderSymbol">'+(rep?.symbol||'--')+'</div><div class="leaderMeta">점수 '+f1(sc)+(rep?.price!=null?' · '+nf(rep.price):'')+'</div></div>';}).join('');}
function stageInfo(r){const d=r.details||{};const pc=d.stage_pass_count??d.stage_passCount??'--';const depth=d.stage_depth??d.stageDepth??'--';return {pc,depth,reason:d.decision_reason||'',onchain:d.onchain_score??d.onchainScore,global:d.global_spot_score,deriv:d.derivatives_risk};}
function top3Cards(rows){const top=(rows||[]).slice().sort((a,b)=>(a.rank||99)-(b.rank||99)).slice(0,3);if(!top.length)return '<div class="empty badText">TOP3 데이터 없음 · 스캐너 오류 확인 필요</div>';return top.map((r,i)=>{const d=stageInfo(r),st=state(r.status,r.score),lo=r.recommended_entry_low,hi=r.recommended_entry_high,inv=r.details?.trade_plan?.invalidation;return '<article class="pick"><div class="pickRank">'+(i+1)+'</div><div class="pickMain"><div class="pickName">'+String(r.market||'').replace('KRW-','')+' <span class="'+st[1]+'">'+st[0]+'</span></div><div class="pickPrice">현재 '+nf(r.krw_price)+'원</div><div class="pickMeta">검증 '+d.pc+'/8 · 연속 '+d.depth+'/8 · 점수 '+f1(r.score)+'</div><div class="pickMeta">진입 '+nf(lo)+' ~ '+nf(hi)+(inv!=null?' · 무효화 '+nf(inv):'')+'</div></div><div class="pickWhy">'+(d.reason||'상대순위 대표 후보')+'</div></article>';}).join('');}
function sectorCards(x){const rows=(x.reps||[]).filter(r=>r.asset_class==='STOCK_SECTOR').sort((a,b)=>(b.total_score||0)-(a.total_score||0));if(!rows.length)return '<div class="empty">섹터 데이터 대기</div>';return rows.slice(0,11).map((r,i)=>'<div class="sector"><div><small>#'+(i+1)+' '+String(r.sector||'').replaceAll('_',' ')+'</small><b>'+r.symbol+'</b></div><div class="sectorRight"><strong>'+f1(r.total_score)+'</strong><span>'+nf(r.price)+'</span></div></div>').join('');}
function portfolioRows(p){const rows=Array.isArray(p)?p:(p?.assets||p?.positions||[]);if(!rows?.length)return '<div class="empty">연결된 보유 데이터 없음</div>';return rows.slice(0,8).map(r=>{const act=state(r.action||r.status,r.score);return '<div class="row"><b>'+String(r.symbol||r.market||r.coin||'')+'</b><span>'+nf(r.price||r.krw_price)+'</span><strong class="'+act[1]+'">'+act[0]+'</strong></div>';}).join('');}
function diagnostics(x){const m=x.macro||{},run=x.lastRun||{};const age=run.started_at?Math.round((Date.now()-new Date(run.started_at))/60000):null;return '<div>레짐 <b>'+String(m.regime||'--')+'</b> · 매크로 '+f1(m.macro_score)+' · 유동성 '+f1(m.liquidity_score)+'</div><div>최근 스캐너 '+(age!=null?age+'분 전':'--')+' · '+String(run.status||'--')+'</div><div>데이터품질 '+f1(m.data_quality)+' · 상세 오류/공급자 상태는 서버 로그에서 관리</div>';}
async function loadAll(){try{const [x,p]=await Promise.all([safe('/api/flow-map'),safe('/api/portfolio').catch(()=>[])]);document.getElementById('decisionHero').innerHTML=mainDecision(x);document.getElementById('leaders').innerHTML=leaderCards(x);document.getElementById('top3').innerHTML=top3Cards(x.cryptoTop||[]);const entries=(x.cryptoTop||[]).filter(r=>String(r.status||'').toUpperCase()==='ENTRY').length;document.getElementById('cryptoState').textContent='승인 '+entries+' · 관찰 '+Math.max(0,(x.cryptoTop||[]).length-entries);document.getElementById('sectors').innerHTML=sectorCards(x);document.getElementById('portfolio').innerHTML=portfolioRows(p);document.getElementById('diag').innerHTML=diagnostics(x);document.getElementById('updated').textContent='최종 갱신 '+new Date().toLocaleString()+' · 60초 자동';}catch(e){document.getElementById('updated').textContent='데이터 오류';document.getElementById('decisionHero').innerHTML='<div class="heroLabel">지금 해야 할 일</div><div class="heroAction bad">신규진입 중단</div><div class="heroReason">데이터 오류 · 진단 영역 확인</div>';}}
loadAll();setInterval(loadAll,60000);
</script></body>`;

const STYLE=`<style id="gn-final-style-v2">:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#080a0d;color:#eef2f6;font-family:system-ui,-apple-system,sans-serif}.wrap{max-width:1100px;margin:auto;padding:16px 16px 48px}header{display:flex;justify-content:space-between;align-items:center;gap:12px}h1{margin:4px 0;font-size:24px}.muted,.sub,.foot{color:#8f9ba7;font-size:12px}button,a{background:#18202a;color:#eef2f6;border:1px solid #33404d;border-radius:9px;padding:8px 10px;text-decoration:none}.decisionHero{margin-top:14px;padding:22px;border-radius:18px;background:linear-gradient(180deg,#151d25,#10151b);border:1px solid #394858}.heroLabel{font-size:12px;color:#9aa7b4}.heroAction{font-size:42px;font-weight:950;letter-spacing:-1.5px;margin:6px 0}.heroReason{font-size:15px;color:#c7d0d9}.sectionTitle{font-size:16px;font-weight:900;margin:20px 0 9px}.sectionHead{display:flex;justify-content:space-between;align-items:end;gap:12px}.pill{font-size:12px;border:1px solid #34414e;background:#111820;padding:7px 10px;border-radius:999px}.leaderGrid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}.leader,.pick,.sector,.row,.empty,.diagnostics{background:#12171d;border:1px solid #27313b;border-radius:14px}.leader{padding:12px}.leaderTop{display:flex;justify-content:space-between;gap:6px;font-size:11px;color:#9aa7b4}.leaderSymbol{font-size:22px;font-weight:950;margin:8px 0 3px}.leaderMeta{font-size:11px;color:#9aa7b4}.top3{display:grid;gap:8px}.pick{display:grid;grid-template-columns:40px 1.2fr 1fr;gap:12px;align-items:center;padding:14px}.pickRank{width:32px;height:32px;border-radius:50%;background:#202833;display:grid;place-items:center;font-weight:950}.pickName{font-size:18px;font-weight:950}.pickName span{font-size:12px;margin-left:6px}.pickPrice{font-size:14px;font-weight:800;margin-top:3px}.pickMeta,.pickWhy{font-size:12px;color:#9aa7b4;margin-top:3px}.pickWhy{border-left:1px solid #2b3641;padding-left:12px}.sectorGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.sector{padding:11px;display:flex;justify-content:space-between;align-items:center;gap:10px}.sector small{display:block;color:#8f9ba7;font-size:10px;margin-bottom:2px}.sector b{font-size:16px}.sectorRight{text-align:right}.sectorRight strong,.sectorRight span{display:block}.sectorRight span{font-size:11px;color:#8f9ba7}.rows{display:grid;gap:7px}.row{display:grid;grid-template-columns:1fr 1fr .7fr;gap:10px;padding:11px}.row strong{text-align:right}.diagnostics{margin-top:22px;padding:12px;color:#9aa7b4;font-size:12px}.diagnostics summary{cursor:pointer;color:#c6d0da;font-weight:800}.diag{display:grid;gap:6px;margin-top:10px}.good{color:#55d98b}.warn{color:#ffd166}.bad,.badText{color:#ff6b6b}.neutral{color:#aeb8c2}.foot{text-align:center;margin-top:18px}@media(max-width:820px){.leaderGrid{grid-template-columns:repeat(3,1fr)}.sectorGrid{grid-template-columns:repeat(2,1fr)}.pick{grid-template-columns:36px 1fr}.pickWhy{grid-column:2;border-left:0;padding-left:0;border-top:1px solid #27313b;padding-top:8px}}@media(max-width:520px){.wrap{padding:12px 10px 36px}.heroAction{font-size:34px}.leaderGrid{grid-template-columns:repeat(2,1fr)}.sectorGrid{grid-template-columns:1fr}.pick{padding:11px}.pickName{font-size:17px}}</style>`;
function patchHtml(html){if(typeof html!=="string"||!html.includes('id="hero"')||html.includes('gn-final-style-v2'))return html;html=html.replace('</head>',STYLE+'</head>');return html.replace(/<body>[\s\S]*<\/body>/,BODY);}
function wrappedExpress(...args){const app=originalExpress(...args);app.use((req,res,next)=>{if(req.path==="/api/flow-map")return flowMap(req,res);const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body));};next();});return app;}
Object.assign(wrappedExpress,originalExpress);require.cache[expressPath].exports=wrappedExpress;
