const express=require("express");
const crypto=require("crypto");
const {createClient}=require("@supabase/supabase-js");
const {collectLiveMarket}=require("./market");
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
function loginPage(error=""){return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>GN PIVOT 로그인</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080a0d;color:#eef2f6;font-family:system-ui,-apple-system,sans-serif;padding:24px}.box{width:min(100%,390px);background:#12171d;border:1px solid #303946;border-radius:18px;padding:24px}h1{margin:0 0 6px;font-size:26px}.sub{color:#99a5b1;font-size:14px;margin-bottom:22px}label{display:block;font-size:13px;color:#b7c1cb;margin:12px 0 6px}input{width:100%;font-size:16px;padding:14px 13px;border-radius:11px;border:1px solid #3a4654;background:#0d1116;color:#fff}button{width:100%;margin-top:18px;padding:14px;border:0;border-radius:11px;background:#2f7cf6;color:#fff;font-size:16px;font-weight:800}.err{background:#3a171b;color:#ff9aa3;border:1px solid #6b272f;padding:10px 12px;border-radius:10px;font-size:13px;margin-bottom:12px}</style></head><body><form class="box" method="post" action="/login"><h1>GN PIVOT</h1><div class="sub">시장 감시 대시보드 로그인</div>${error?`<div class="err">${error}</div>`:""}<label>아이디</label><input name="username" autocomplete="username" required><label>비밀번호</label><input name="password" type="password" autocomplete="current-password" required><button type="submit">로그인</button></form></body></html>`;}

app.use(express.urlencoded({extended:false}));
app.get("/health",(req,res)=>res.json({ok:true,time:new Date().toISOString()}));
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
app.get("/api/alerts",async(req,res)=>{const {data,error}=await db.from("gn_alerts").select("*").order("ts",{ascending:false}).limit(50);if(error)return res.status(500).json({error:error.message});res.json(data);});
app.get("/api/runs",async(req,res)=>{const {data,error}=await db.from("gn_runs").select("*").order("started_at",{ascending:false}).limit(30);if(error)return res.status(500).json({error:error.message});res.json(data);});
app.get("/api/pre-pump/latest",createLatestPrePumpHandler({db}));

app.get("/",(req,res)=>res.type("html").send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GN Market Radar</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#080a0d;color:#eef2f6}.wrap{max-width:1040px;margin:auto;padding:14px}.top{display:flex;justify-content:space-between;align-items:center;gap:10px}.muted{color:#99a5b1;font-size:12px}.topActions{display:flex;gap:8px;align-items:center}.logout{color:#b7c1cb;text-decoration:none;border:1px solid #3a4654;padding:8px 10px;border-radius:9px;font-size:12px}h1{font-size:21px;margin:8px 0}.hero,.card{background:#12171d;border:1px solid #27313b;border-radius:14px;padding:13px}.hero{border-color:#303946;border-radius:16px;padding:16px;margin:12px 0}.action{font-size:34px;font-weight:900}.marketscore{font-size:46px;font-weight:900}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.score{font-size:26px;font-weight:900}.row{display:flex;justify-content:space-between;gap:10px;margin-top:7px;font-size:13px}.good{color:#55d98b}.warn{color:#ffd166}.bad{color:#ff6b6b}.blue{color:#69a7ff}.pill{display:inline-block;padding:4px 8px;border-radius:999px;background:#202833;margin:3px 4px 0 0;font-size:12px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{padding:8px;border-bottom:1px solid #27303a;text-align:left}button{background:#202833;color:white;border:1px solid #3a4654;padding:8px 12px;border-radius:9px}h2{font-size:16px;margin-top:20px}</style></head><body><div class="wrap"><div class="top"><div><h1>GN 시장 전체 감시</h1><div class="muted" id="updated">불러오는 중…</div></div><div class="topActions"><button onclick="loadAll()">새로고침</button><a class="logout" href="/logout">로그아웃</a></div></div><div class="hero" id="hero"></div><h2>5-AI 합의</h2><div class="grid" id="aiConsensus"></div><h2>시장 폭 · 파생시장</h2><div class="grid" id="marketMetrics"></div><h2>회전 후보</h2><div class="grid" id="cards"></div><h2>Pre-Pump TOP3</h2><div class="card" id="prePump"></div><h2>상승/하락 주도</h2><div class="card" id="movers"></div><h2>최근 신호</h2><div class="card"><table><tbody id="alerts"></tbody></table></div></div><script>
const pct=(x,d=1)=>x==null?"N/A":(Number(x)*100).toFixed(d)+"%";const pctRaw=(x,d=1)=>x==null?"N/A":Number(x).toFixed(d)+"%";const n=x=>x==null?"N/A":Number(x).toLocaleString();async function safe(url){const r=await fetch(url);if(r.status===401){location.href='/login';throw new Error('로그인이 필요합니다');}if(!r.ok)throw new Error(await r.text());return r.json();}
function hero(m){const d=m?.decision;if(!d)return '<div class="bad">시장 전체 데이터 수집 실패</div>';const raw=d.aiApplied?'<div class="muted">시장 원점수 '+d.rawScore+' → AI 반영 최종점수</div>':'<div class="muted">시장 점수 · AI 미반영</div>';return '<div class="muted">지금 행동</div><div class="action">'+d.action+'</div>'+raw+'<div class="marketscore">'+d.score+'</div><div>'+d.regime+'</div><div>'+((d.reasons||[]).map(x=>'<span class="pill">'+x+'</span>').join(''))+'</div>';}
function aiCards(ai){if(!ai?.available)return '<div class="card bad">AI 분석 데이터 없음</div>';const title='<div class="card"><div class="muted">GN AI 합의</div><div class="score">'+(ai.sentiment||'N/A')+'</div><div>'+ai.successCount+'/5 성공 · AI점수 '+(ai.score??'N/A')+'</div><div class="muted">'+(ai.eligible?'최종판정 반영 중':'최종판정 미반영')+' · '+(ai.ageMinutes??'?')+'분 전</div></div>';const rows=(ai.providers||[]).map(r=>'<div class="card"><b>'+r.provider+'</b><div class="score '+(r.status==='success'?'good':'bad')+'">'+r.status+'</div><div>'+(r.sentiment||r.error_code||'N/A')+'</div><div class="muted">신뢰도 '+(r.confidence==null?'N/A':Math.round(Number(r.confidence)*100)+'%')+'</div></div>').join('');return title+rows;}
function metrics(m){const s=m?.spot,f=m?.funding,b=m?.btcTaker,e=m?.ethTaker;return [['상승 종목 비율',s?((s.breadth100*100).toFixed(0)+'%'):'N/A','상위 거래대금 100개'],['시장 중앙값',s?pctRaw(s.median100,2):'N/A','24시간 등락 중앙값'],['거래대금 가중 등락',s?pctRaw(s.volumeWeighted100,2):'N/A','주도 자금 방향'],['과열 펀딩 비율',f?((f.hot*100).toFixed(0)+'%'):'N/A','|funding| ≥ 0.05%'],['BTC 매수/매도 체결',b?Number(b.avg15m).toFixed(2):'N/A',b?.source==='snapshot-fallback'?'최근 저장값 사용':'1 초과=매수 우위'],['ETH 매수/매도 체결',e?Number(e.avg15m).toFixed(2):'N/A',e?.source==='snapshot-fallback'?'최근 저장값 사용':'1 초과=매수 우위']].map(x=>'<div class="card"><div class="muted">'+x[0]+'</div><div class="score">'+x[1]+'</div><div class="muted">'+x[2]+'</div></div>').join('');}
function movers(m){const s=m?.spot;if(!s)return 'N/A';const one=(x,g)=>'<span class="pill '+(g?'good':'bad')+'">'+x.symbol+' '+(x.change>=0?'+':'')+x.change.toFixed(1)+'%</span>';return '<div class="muted">상승 주도</div>'+s.leaders.map(x=>one(x,true)).join('')+'<div class="muted" style="margin-top:12px">하락 주도</div>'+s.laggards.map(x=>one(x,false)).join('');}
function coinCards(rows){return (rows||[]).map(r=>'<div class="card"><b>'+r.coin+'</b><div class="score">'+Number(r.score).toFixed(2)+'</div><div>'+r.stage+'</div><div class="row"><span>원화</span><b>'+n(r.krw_price)+'</b></div><div class="row"><span>RS 4h / 24h</span><b>'+pct(r.rs4)+' / '+pct(r.rs24)+'</b></div></div>').join('');}
function prePumpTable(rows){if(!rows||!rows.length)return '<div class="muted">No scanner data yet</div>';return '<table><thead><tr><th>순위</th><th>마켓</th><th>점수</th><th>상태</th><th>5분</th><th>15분</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+r.rank+'</td><td><b>'+r.market+'</b></td><td>'+Number(r.score).toFixed(2)+'</td><td>'+r.status+'</td><td>'+pct(r.return5m,2)+'</td><td>'+pct(r.return15m,2)+'</td></tr>').join('')+'</tbody></table>';}
async function loadAll(){try{const [market,latest,alerts,prePump]=await Promise.all([safe('/api/market/live'),safe('/api/latest'),safe('/api/alerts'),safe('/api/pre-pump/latest').catch(()=>[])]);document.getElementById('hero').innerHTML=hero(market);document.getElementById('aiConsensus').innerHTML=aiCards(market.ai);document.getElementById('marketMetrics').innerHTML=metrics(market);document.getElementById('cards').innerHTML=coinCards(latest);document.getElementById('prePump').innerHTML=prePumpTable(prePump);document.getElementById('movers').innerHTML=movers(market);document.getElementById('updated').textContent='실시간 시장 '+new Date(market.ts).toLocaleString()+' · 자동 갱신 60초';document.getElementById('alerts').innerHTML=(alerts||[]).slice(0,12).map(a=>'<tr><td>'+new Date(a.ts).toLocaleString()+'</td><td>'+a.coin+'</td><td>'+(a.stage||a.level)+'</td><td>'+a.message+'</td></tr>').join('');}catch(e){document.getElementById('updated').textContent='오류: '+e.message;}}loadAll();setInterval(loadAll,60000);
</script></body></html>`));

const port=process.env.PORT||10000;app.listen(port,()=>console.log("GN market dashboard listening",port));
