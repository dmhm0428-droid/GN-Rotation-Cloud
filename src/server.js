const express=require("express");
const crypto=require("crypto");
const {createClient}=require("@supabase/supabase-js");
const {collectLiveMarket}=require("./market");
const {loadPortfolio}=require("./exchange-portfolio");
const {createDeepSeekTestHandler}=require("./ai/deepseek-admin");
const {createLatestPrePumpHandler}=require("./pre-pump-dashboard");
const app=express();

const URL=process.env.SUPABASE_URL, KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!URL||!KEY)throw new Error("Supabase env vars missing");
const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const USER=process.env.DASHBOARD_USER||"gn";
const PASS=process.env.DASHBOARD_PASSWORD;
if(!PASS)throw new Error("DASHBOARD_PASSWORD is required");

const COOKIE_NAME="gn_auth";
const authToken=()=>crypto.createHmac("sha256",PASS).update(USER).digest("hex");
function getCookie(req,name){const raw=req.headers.cookie||"";for(const part of raw.split(";")){const i=part.indexOf("=");if(i<0)continue;if(part.slice(0,i).trim()===name)return decodeURIComponent(part.slice(i+1).trim());}return "";}
function isAuthed(req){return getCookie(req,COOKIE_NAME)===authToken();}
function auth(req,res,next){if(isAuthed(req))return next();if(req.path.startsWith("/api/"))return res.status(401).json({error:"Authentication required"});return res.redirect("/login");}
function loginPage(error=""){return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>GN PIVOT 로그인</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080a0d;color:#eef2f6;font-family:system-ui,-apple-system,sans-serif;padding:24px}.box{width:min(100%,390px);background:#12171d;border:1px solid #303946;border-radius:18px;padding:24px}h1{margin:0 0 6px;font-size:26px}.sub{color:#99a5b1;font-size:14px;margin-bottom:22px}label{display:block;font-size:13px;color:#b7c1cb;margin:12px 0 6px}input{width:100%;font-size:16px;padding:14px 13px;border-radius:11px;border:1px solid #3a4654;background:#0d1116;color:#fff}button{width:100%;margin-top:18px;padding:14px;border:0;border-radius:11px;background:#2f7cf6;color:#fff;font-size:16px;font-weight:800}.err{background:#3a171b;color:#ff9aa3;border:1px solid #6b272f;padding:10px 12px;border-radius:10px;font-size:13px;margin-bottom:12px}</style></head><body><form class="box" method="post" action="/login"><h1>GN PIVOT</h1><div class="sub">단타 감시 대시보드 로그인</div>${error?`<div class="err">${error}</div>`:""}<label>아이디</label><input name="username" autocomplete="username" required><label>비밀번호</label><input name="password" type="password" autocomplete="current-password" required><button type="submit">로그인</button></form></body></html>`;}

app.use(express.urlencoded({extended:false}));
app.get("/health",(req,res)=>res.json({ok:true,time:new Date().toISOString(),mode:"SCALP_INTRADAY"}));
app.get("/login",(req,res)=>isAuthed(req)?res.redirect("/"):res.type("html").send(loginPage()));
app.post("/login",(req,res)=>{const u=String(req.body?.username||"");const p=String(req.body?.password||"");if(u!==USER||p!==PASS)return res.status(401).type("html").send(loginPage("아이디 또는 비밀번호가 맞지 않습니다."));const secure=(req.headers["x-forwarded-proto"]||req.protocol)==="https";res.setHeader("Set-Cookie",`${COOKIE_NAME}=${encodeURIComponent(authToken())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure?"; Secure":""}`);return res.redirect("/");});
app.get("/logout",(req,res)=>{res.setHeader("Set-Cookie",`${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);res.redirect("/login");});
app.use(auth);app.use(express.json());

const AI_PROVIDERS=["perplexity","xai","deepseek","anthropic","gemini"];
const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,x));
function actionFromScore(score,baseAction){
  if(score<30)return {action:"매수금지",regime:"위험회피"};
  if(score<45)return {action:"대기",regime:"약세"};
  if(score<60)return {action:"관찰",regime:"혼조"};
  if(score<72)return {action:"확인매수",regime:"위험선호 전환"};
  if(baseAction==="추격금지")return {action:"추격금지",regime:"강세·레버리지 과열"};
  return {action:"추가매수",regime:"시장 확산"};
}
async function latestAiConsensus(){
  const {data,error}=await db.from("gn_ai_analyses").select("provider,model,status,sentiment,confidence,summary,signals,error_code,created_at,source_snapshot_ts").order("created_at",{ascending:false}).limit(15);
  if(error)throw error;
  const all=data||[];
  if(!all.length)return {available:false,eligible:false,providers:[],successCount:0,totalProviders:5,reason:"AI 분석 없음"};
  const latestAt=all[0].created_at;
  const rows=all.filter(r=>r.created_at===latestAt);
  const byProvider={};for(const r of rows)if(AI_PROVIDERS.includes(r.provider)&&!byProvider[r.provider])byProvider[r.provider]=r;
  const providers=AI_PROVIDERS.map(name=>byProvider[name]||{provider:name,status:"missing",sentiment:null,confidence:null,error_code:"NO_LATEST_ROW"});
  const success=providers.filter(r=>r.status==="success"&&["risk_off","neutral","risk_on"].includes(r.sentiment));
  const scoreOf={risk_off:-1,neutral:0,risk_on:1};
  let weighted=0,weight=0,confidenceSum=0;
  for(const r of success){const c=Math.max(.05,Math.min(1,Number(r.confidence)||.5));weighted+=scoreOf[r.sentiment]*c;weight+=c;confidenceSum+=c;}
  const mean=weight?weighted/weight:0;
  const aiScore=clamp(50+mean*50);
  const sentiment=mean<=-.25?"risk_off":mean>=.25?"risk_on":"neutral";
  const confidence=success.length?confidenceSum/success.length:0;
  const ageMs=Date.now()-new Date(latestAt).getTime();
  const fresh=Number.isFinite(ageMs)&&ageMs>=0&&ageMs<=30*60*1000;
  const eligible=fresh&&success.length>=3;
  return {available:true,eligible,fresh,createdAt:latestAt,sourceSnapshotTs:rows[0]?.source_snapshot_ts||null,providers,successCount:success.length,totalProviders:5,sentiment,confidence:+confidence.toFixed(2),score:+aiScore.toFixed(1),ageMinutes:Number.isFinite(ageMs)?+(ageMs/60000).toFixed(1):null};
}
function mergeAiDecision(base,ai){
  if(!base)return base;
  if(!ai?.eligible)return {...base,rawScore:base.score,aiApplied:false,ai};
  const rawScore=Number(base.score)||0;
  const finalScore=clamp(rawScore*.70+ai.score*.30);
  const state=actionFromScore(finalScore,base.action);
  const label=ai.sentiment==="risk_off"?"위험회피":ai.sentiment==="risk_on"?"위험선호":"중립";
  const reasons=[`AI ${ai.successCount}/5 합의 ${label} · 신뢰도 ${(ai.confidence*100).toFixed(0)}%`,...(base.reasons||[])].slice(0,4);
  return {...base,rawScore:+rawScore.toFixed(1),score:+finalScore.toFixed(1),action:state.action,regime:state.regime,reasons,aiApplied:true,ai};
}

app.get("/api/latest",async(req,res)=>{const {data,error}=await db.from("gn_snapshots").select("*").order("ts",{ascending:false}).limit(20);if(error)return res.status(500).json({error:error.message});const latest={};for(const r of data||[])if(!latest[r.coin])latest[r.coin]=r;res.json(Object.values(latest).sort((a,b)=>(a.rank||99)-(b.rank||99)));});
app.get("/api/market/latest",async(req,res)=>{const {data,error}=await db.from("gn_market_snapshots").select("*").order("ts",{ascending:false}).limit(1).maybeSingle();if(error)return res.status(500).json({error:error.message});res.json(data||null);});
app.get("/api/ai/latest",async(req,res)=>{try{res.json(await latestAiConsensus());}catch(e){res.status(500).json({error:String(e.message||e)});}});
app.post("/api/admin/ai-test/deepseek",createDeepSeekTestHandler({db,env:process.env}));

let liveCache={at:0,data:null};
function ratioFallback(value){const n=Number(value);return Number.isFinite(n)?{current:n,avg15m:n,source:"snapshot-fallback"}:null;}
app.get("/api/market/live",async(req,res)=>{
  try{
    if(liveCache.data&&Date.now()-liveCache.at<45000)return res.json(liveCache.data);
    const [{data:btcRows,error:btcErr},{data:savedMarket,error:savedErr},aiResult]=await Promise.all([
      db.from("gn_snapshots").select("rs4,rs24,macro_score").eq("coin","BTC").order("ts",{ascending:false}).limit(1),
      db.from("gn_market_snapshots").select("btc_taker_ratio,eth_taker_ratio,ts").order("ts",{ascending:false}).limit(1).maybeSingle(),
      latestAiConsensus().catch(error=>({available:false,eligible:false,providers:[],successCount:0,totalProviders:5,reason:String(error.message||error)}))
    ]);
    const b=btcErr?null:btcRows?.[0];
    const market=await collectLiveMarket({btc:b?{r1:0,r24:+b.rs24}:null,macroScore:b?.macro_score??5});
    if(!market.btcTaker&&!savedErr&&savedMarket)market.btcTaker=ratioFallback(savedMarket.btc_taker_ratio);
    if(!market.ethTaker&&!savedErr&&savedMarket)market.ethTaker=ratioFallback(savedMarket.eth_taker_ratio);
    market.errors=market.errors||{};
    if(btcErr)market.errors.btcSnapshot=btcErr.message;
    if(savedErr)market.errors.marketSnapshot=savedErr.message;
    market.ai=aiResult;
    market.decision=mergeAiDecision(market.decision,aiResult);
    liveCache={at:Date.now(),data:market};
    res.json(market);
  }catch(e){res.status(500).json({error:String(e.message||e)});}
});

const ACTIVE_SIGNAL_MS=30*60*1000;
function enrichAlert(a){
  const ageMs=Date.now()-new Date(a.ts).getTime();
  const ageMinutes=Number.isFinite(ageMs)?Math.max(0,ageMs/60000):null;
  const active=ageMinutes!=null&&ageMs>=0&&ageMs<=ACTIVE_SIGNAL_MS;
  return {...a,active,age_minutes:ageMinutes==null?null:+ageMinutes.toFixed(1),valid_until:active?new Date(new Date(a.ts).getTime()+ACTIVE_SIGNAL_MS).toISOString():null};
}
app.get("/api/alerts",async(req,res)=>{const {data,error}=await db.from("gn_alerts").select("*").order("ts",{ascending:false}).limit(50);if(error)return res.status(500).json({error:error.message});res.json((data||[]).map(enrichAlert));});
app.get("/api/portfolio",async(req,res)=>{try{res.json(await loadPortfolio());}catch(e){res.status(500).json({error:String(e.message||e)});}});
app.get("/api/runs",async(req,res)=>{const {data,error}=await db.from("gn_runs").select("*").order("started_at",{ascending:false}).limit(30);if(error)return res.status(500).json({error:error.message});res.json(data);});
app.get("/api/pre-pump/latest",createLatestPrePumpHandler({db}));

app.get("/",(req,res)=>res.type("html").send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>GN PIVOT · 단타</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#080a0d;color:#eef2f6}.wrap{max-width:760px;margin:auto;padding:14px 14px 42px}.top{display:flex;justify-content:space-between;align-items:center;gap:10px}.muted{color:#99a5b1;font-size:12px}.mode{display:inline-block;margin-top:4px;padding:4px 8px;border:1px solid #385071;border-radius:999px;color:#a8c7ff;font-size:11px;font-weight:800}.topActions{display:flex;gap:8px;align-items:center}.logout{color:#b7c1cb;text-decoration:none;border:1px solid #3a4654;padding:8px 10px;border-radius:9px;font-size:12px}button{background:#202833;color:white;border:1px solid #3a4654;padding:8px 12px;border-radius:9px}h1{font-size:21px;margin:8px 0 0}h2{font-size:15px;margin:20px 2px 9px}.hero,.card{background:#12171d;border:1px solid #27313b;border-radius:16px;padding:16px}.hero{margin:12px 0;border-color:#364352}.eyebrow{font-size:12px;color:#99a5b1;margin-bottom:4px}.action{font-size:36px;font-weight:950;letter-spacing:-1.4px}.subaction{margin-top:4px;font-size:14px;color:#b7c1cb}.rule{margin-top:10px;padding-top:10px;border-top:1px solid #27313b;color:#99a5b1;font-size:12px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.coin{min-width:0}.coinName{font-size:14px;font-weight:800;color:#c4ced8}.coinAction{font-size:22px;font-weight:950;margin:7px 0;line-height:1.05}.price{font-size:13px;font-weight:800}.good{color:#55d98b}.warn{color:#ffd166}.bad{color:#ff6b6b}.neutral{color:#b7c1cb}.top3{display:grid;gap:9px}.pick{display:grid;grid-template-columns:34px 1fr auto;align-items:start;gap:10px;background:#12171d;border:1px solid #27313b;border-radius:14px;padding:13px}.rank{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#202833;font-weight:900}.pickName{font-weight:900;font-size:16px}.pickMeta{font-size:12px;color:#99a5b1;margin-top:3px;line-height:1.45}.pickAction{font-size:17px;font-weight:950;text-align:right;white-space:nowrap}.metrics{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.pill{padding:4px 7px;border-radius:999px;background:#0d1116;border:1px solid #27313b;color:#b7c1cb;font-size:11px}.pill.hot{border-color:#4b6b4f;color:#8fe0a9}.pill.stop{border-color:#6b3b42;color:#ff9aa3}.reason{margin-top:7px;font-size:12px;color:#c4ced8}.empty{padding:16px;color:#99a5b1;background:#12171d;border:1px solid #27313b;border-radius:14px}.foot{margin-top:18px;text-align:center;color:#687582;font-size:11px}@media(max-width:560px){.grid{grid-template-columns:1fr}.card{display:grid;grid-template-columns:72px 1fr auto;align-items:center;gap:8px;padding:13px}.coinAction{margin:0;font-size:21px}.price{text-align:right}.action{font-size:34px}.pick{grid-template-columns:30px 1fr}.pickAction{grid-column:2;text-align:left;margin-top:3px}}
</style></head><body><div class="wrap"><div class="top"><div><h1>GN PIVOT</h1><div class="mode">SCALP · 당일/최대 익일 초반</div><div class="muted" id="updated">불러오는 중…</div></div><div class="topActions"><button onclick="loadAll()">새로고침</button><a class="logout" href="/logout">로그아웃</a></div></div><div class="hero" id="hero"></div><h2>BTC · ETH · SOL 시장받침</h2><div class="grid" id="majors"></div><h2>단타 TOP3 · 익절/러너 관리</h2><div class="top3" id="top3"></div><div class="foot">원칙: 첫 수익은 확보 · 강한 러너만 남김 · 약한 종목 물타기 금지 · 장기보유 판단 아님</div></div><script>
const n=x=>x==null?'':Number(x).toLocaleString();
const f=x=>Number.isFinite(Number(x))?Number(x).toFixed(1):'-';
async function safe(url){const r=await fetch(url);if(r.status===401){location.href='/login';throw new Error('로그인이 필요합니다');}if(!r.ok)throw new Error(await r.text());return r.json();}
function simpleAction(raw,score){const s=String(raw||'').toUpperCase();if(s.includes('SELL')||s.includes('EXIT')||s.includes('손절')||s.includes('매도'))return {text:'팔아라',cls:'bad'};if(s.includes('NO_CHASE')||s.includes('추격금지')||s.includes('매수금지'))return {text:'사지 마라',cls:'bad'};if(s.includes('ENTRY')||s.includes('BUY')||s.includes('추가매수')||s.includes('확인매수'))return {text:'사라',cls:'good'};if(s.includes('SCOUT')||s.includes('WAIT')||s.includes('대기')||s.includes('관찰'))return {text:'기다려',cls:'warn'};const v=Number(score);if(Number.isFinite(v)){if(v>=72)return {text:'사라',cls:'good'};if(v<30)return {text:'사지 마라',cls:'bad'};}return {text:'기다려',cls:'warn'};}
function gnAction(row){const s=String(row?.action||'').trim();if(s==='러너청산')return {text:'러너 청산',cls:'bad'};if(s==='수익보호')return {text:'수익 보호',cls:'warn'};if(s==='2차익절')return {text:'2차 익절',cls:'good'};if(s==='1차익절')return {text:'1차 익절',cls:'good'};if(s==='물타기금지')return {text:'물타기 금지',cls:'bad'};if(s==='매도준비')return {text:'정리 준비',cls:'warn'};if(s==='보유점검')return {text:'반등 확인',cls:'warn'};if(s==='러너유지')return {text:'러너 유지',cls:'good'};if(s==='단타보유')return {text:'단타 보유',cls:'good'};if(s==='진입유지'||s==='진입')return {text:'진입',cls:'good'};if(s==='추격금지')return {text:'추격 금지',cls:'bad'};return simpleAction(row?.status,row?.score);}
function marketHero(m){const d=m?.decision;if(!d)return '<div class="action bad">기다려</div><div class="subaction">시장 데이터 확인 중</div>';const a=simpleAction(d.action,d.score);return '<div class="eyebrow">단타 시장받침</div><div class="action '+a.cls+'">'+a.text+'</div><div class="subaction">'+(d.regime||'')+' · 시장점수 '+f(d.score)+'</div><div class="rule">개별 코인이 강해도 시장받침이 깨지면 러너 축소. 장기보유 신호로 사용하지 않음.</div>';}
function majorCards(rows){const wanted=['BTC','ETH','SOL'];const by={};for(const r of rows||[])by[String(r.coin||'').toUpperCase()]=r;return wanted.map(c=>{const r=by[c];if(!r)return '<div class="card coin"><div class="coinName">'+c+'</div><div class="coinAction neutral">확인 중</div><div class="price"></div></div>';const a=simpleAction(r.stage,r.score);return '<div class="card coin"><div class="coinName">'+c+'</div><div class="coinAction '+a.cls+'">'+a.text+'</div><div class="price">'+(r.krw_price!=null?n(r.krw_price)+'원':'')+'</div></div>';}).join('');}
function top3Cards(rows){const top=(rows||[]).slice(0,3);if(!top.length)return '<div class="empty">지금은 단타 신규 진입 후보 없음</div>';return top.map((r,i)=>{const a=gnAction(r);const px=r.krwPrice!=null?'현재 '+n(r.krwPrice)+'원':'';const entry=r.recommendedEntry!=null?'진입 '+n(r.recommendedEntry)+'원':'';const mfe='MFE +'+f(r.mfePct)+'%';const gain='현재 '+(Number(r.gainFromEntryPct)>=0?'+':'')+f(r.gainFromEntryPct)+'%';const floor=r.profitFloorPct!=null?'수익바닥 +'+f(r.profitFloorPct)+'%':'수익바닥 -';const next=r.nextTakeProfitPct!=null?'다음익절 +'+f(r.nextTakeProfitPct)+'%':'러너구간';const runner=r.runnerAllowed?'러너 허용':'러너 미허용';const avg=r.averageDownAllowed===false?'물타기 금지':'';return '<div class="pick"><div class="rank">'+(i+1)+'</div><div><div class="pickName">'+String(r.market||'').replace('KRW-','')+'</div><div class="pickMeta">'+[px,entry,'점수 '+f(r.score)].filter(Boolean).join(' · ')+'</div><div class="metrics"><span class="pill hot">'+mfe+'</span><span class="pill">'+gain+'</span><span class="pill">'+floor+'</span><span class="pill">'+next+'</span><span class="pill">'+runner+'</span>'+(avg?'<span class="pill stop">'+avg+'</span>':'')+'</div><div class="reason">'+(r.actionReason||r.status||'')+'</div></div><div class="pickAction '+a.cls+'">'+a.text+'</div></div>';}).join('');}
async function loadAll(){try{const [market,latest,prePump]=await Promise.all([safe('/api/market/live'),safe('/api/latest'),safe('/api/pre-pump/latest').catch(()=>[])]);document.getElementById('hero').innerHTML=marketHero(market);document.getElementById('majors').innerHTML=majorCards(latest);document.getElementById('top3').innerHTML=top3Cards(prePump);document.getElementById('updated').textContent='업데이트 '+new Date(market.ts||Date.now()).toLocaleString()+' · 60초 자동';}catch(e){document.getElementById('updated').textContent='오류: '+e.message;document.getElementById('hero').innerHTML='<div class="action bad">기다려</div><div class="subaction">데이터 오류 · 신규 진입 금지</div>';}}
loadAll();setInterval(loadAll,60000);
</script></body></html>`));

const port=process.env.PORT||10000;app.listen(port,()=>console.log("GN scalp dashboard listening",port));