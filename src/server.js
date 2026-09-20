const express=require("express");
const crypto=require("crypto");
const {createClient}=require("@supabase/supabase-js");
const {collectLiveMarket}=require("./market");
const {loadPortfolio}=require("./exchange-portfolio");
const {createDeepSeekTestHandler}=require("./ai/deepseek-admin");
const {createLatestPrePumpHandler}=require("./pre-pump-dashboard");
const app=express();

const URL=process.env.SUPABASE_URL,KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
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
function loginPage(error=""){return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GN PIVOT 로그인</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080a0d;color:#eef2f6;font-family:system-ui,-apple-system,sans-serif;padding:24px}.box{width:min(100%,390px);background:#12171d;border:1px solid #303946;border-radius:18px;padding:24px}h1{margin:0 0 6px;font-size:26px}.sub{color:#99a5b1;font-size:14px;margin-bottom:22px}label{display:block;font-size:13px;color:#b7c1cb;margin:12px 0 6px}input{width:100%;font-size:16px;padding:14px 13px;border-radius:11px;border:1px solid #3a4654;background:#0d1116;color:#fff}button{width:100%;margin-top:18px;padding:14px;border:0;border-radius:11px;background:#2f7cf6;color:#fff;font-size:16px;font-weight:800}.err{background:#3a171b;color:#ff9aa3;border:1px solid #6b272f;padding:10px 12px;border-radius:10px;font-size:13px;margin-bottom:12px}</style></head><body><form class="box" method="post" action="/login"><h1>GN PIVOT</h1><div class="sub">투자비서 대시보드</div>${error?`<div class="err">${error}</div>`:""}<label>아이디</label><input name="username" autocomplete="username" required><label>비밀번호</label><input name="password" type="password" autocomplete="current-password" required><button type="submit">로그인</button></form></body></html>`;}

app.use(express.urlencoded({extended:false}));
app.get("/health",(req,res)=>res.json({ok:true,time:new Date().toISOString(),mode:"INVESTMENT_ASSISTANT"}));
app.get("/login",(req,res)=>isAuthed(req)?res.redirect("/"):res.type("html").send(loginPage()));
app.post("/login",(req,res)=>{const u=String(req.body?.username||"");const p=String(req.body?.password||"");if(u!==USER||p!==PASS)return res.status(401).type("html").send(loginPage("아이디 또는 비밀번호가 맞지 않습니다."));const secure=(req.headers["x-forwarded-proto"]||req.protocol)==="https";res.setHeader("Set-Cookie",`${COOKIE_NAME}=${encodeURIComponent(authToken())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure?"; Secure":""}`);return res.redirect("/");});
app.get("/logout",(req,res)=>{res.setHeader("Set-Cookie",`${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);res.redirect("/login");});
app.use(auth);app.use(express.json());

const AI_PROVIDERS=["perplexity","xai","deepseek","anthropic","gemini"];
const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,x));
function actionFromScore(score,baseAction){if(score<30)return{action:"매수금지",regime:"위험회피"};if(score<45)return{action:"대기",regime:"약세"};if(score<60)return{action:"관찰",regime:"혼조"};if(score<72)return{action:"확인매수",regime:"위험선호 전환"};if(baseAction==="추격금지")return{action:"추격금지",regime:"강세·레버리지 과열"};return{action:"추가매수",regime:"시장 확산"};}
async function latestAiConsensus(){const {data,error}=await db.from("gn_ai_analyses").select("provider,model,status,sentiment,confidence,summary,signals,error_code,created_at,source_snapshot_ts").order("created_at",{ascending:false}).limit(15);if(error)throw error;const all=data||[];if(!all.length)return{available:false,eligible:false,providers:[],successCount:0,totalProviders:5,reason:"AI 분석 없음"};const latestAt=all[0].created_at;const rows=all.filter(r=>r.created_at===latestAt);const byProvider={};for(const r of rows)if(AI_PROVIDERS.includes(r.provider)&&!byProvider[r.provider])byProvider[r.provider]=r;const providers=AI_PROVIDERS.map(name=>byProvider[name]||{provider:name,status:"missing",sentiment:null,confidence:null,error_code:"NO_LATEST_ROW"});const success=providers.filter(r=>r.status==="success"&&["risk_off","neutral","risk_on"].includes(r.sentiment));const scoreOf={risk_off:-1,neutral:0,risk_on:1};let weighted=0,weight=0,confidenceSum=0;for(const r of success){const c=Math.max(.05,Math.min(1,Number(r.confidence)||.5));weighted+=scoreOf[r.sentiment]*c;weight+=c;confidenceSum+=c;}const mean=weight?weighted/weight:0;const aiScore=clamp(50+mean*50);const sentiment=mean<=-.25?"risk_off":mean>=.25?"risk_on":"neutral";const confidence=success.length?confidenceSum/success.length:0;const ageMs=Date.now()-new Date(latestAt).getTime();const fresh=Number.isFinite(ageMs)&&ageMs>=0&&ageMs<=30*60*1000;const eligible=fresh&&success.length>=3;return{available:true,eligible,fresh,createdAt:latestAt,sourceSnapshotTs:rows[0]?.source_snapshot_ts||null,providers,successCount:success.length,totalProviders:5,sentiment,confidence:+confidence.toFixed(2),score:+aiScore.toFixed(1),ageMinutes:Number.isFinite(ageMs)?+(ageMs/60000).toFixed(1):null};}
function mergeAiDecision(base,ai){if(!base)return base;if(!ai?.eligible)return{...base,rawScore:base.score,aiApplied:false,ai};const rawScore=Number(base.score)||0;const finalScore=clamp(rawScore*.70+ai.score*.30);const state=actionFromScore(finalScore,base.action);const label=ai.sentiment==="risk_off"?"위험회피":ai.sentiment==="risk_on"?"위험선호":"중립";const reasons=[`AI ${ai.successCount}/5 합의 ${label} · 신뢰도 ${(ai.confidence*100).toFixed(0)}%`,...(base.reasons||[])].slice(0,4);return{...base,rawScore:+rawScore.toFixed(1),score:+finalScore.toFixed(1),action:state.action,regime:state.regime,reasons,aiApplied:true,ai};}

app.get("/api/latest",async(req,res)=>{const {data,error}=await db.from("gn_snapshots").select("*").order("ts",{ascending:false}).limit(40);if(error)return res.status(500).json({error:error.message});const latest={};for(const r of data||[])if(!latest[r.coin])latest[r.coin]=r;res.json(Object.values(latest).sort((a,b)=>(a.rank||99)-(b.rank||99)));});
app.get("/api/market/latest",async(req,res)=>{const {data,error}=await db.from("gn_market_snapshots").select("*").order("ts",{ascending:false}).limit(1).maybeSingle();if(error)return res.status(500).json({error:error.message});res.json(data||null);});
app.get("/api/ai/latest",async(req,res)=>{try{res.json(await latestAiConsensus());}catch(e){res.status(500).json({error:String(e.message||e)});}});
app.post("/api/admin/ai-test/deepseek",createDeepSeekTestHandler({db,env:process.env}));
let liveCache={at:0,data:null};
function ratioFallback(value){const n=Number(value);return Number.isFinite(n)?{current:n,avg15m:n,source:"snapshot-fallback"}:null;}
app.get("/api/market/live",async(req,res)=>{try{if(liveCache.data&&Date.now()-liveCache.at<45000)return res.json(liveCache.data);const [{data:btcRows,error:btcErr},{data:savedMarket,error:savedErr},aiResult]=await Promise.all([db.from("gn_snapshots").select("rs4,rs24,macro_score").eq("coin","BTC").order("ts",{ascending:false}).limit(1),db.from("gn_market_snapshots").select("btc_taker_ratio,eth_taker_ratio,ts").order("ts",{ascending:false}).limit(1).maybeSingle(),latestAiConsensus().catch(error=>({available:false,eligible:false,providers:[],successCount:0,totalProviders:5,reason:String(error.message||error)}))]);const b=btcErr?null:btcRows?.[0];const market=await collectLiveMarket({btc:b?{r1:0,r24:+b.rs24}:null,macroScore:b?.macro_score??5});if(!market.btcTaker&&!savedErr&&savedMarket)market.btcTaker=ratioFallback(savedMarket.btc_taker_ratio);if(!market.ethTaker&&!savedErr&&savedMarket)market.ethTaker=ratioFallback(savedMarket.eth_taker_ratio);market.errors=market.errors||{};if(btcErr)market.errors.btcSnapshot=btcErr.message;if(savedErr)market.errors.marketSnapshot=savedErr.message;market.ai=aiResult;market.decision=mergeAiDecision(market.decision,aiResult);liveCache={at:Date.now(),data:market};res.json(market);}catch(e){res.status(500).json({error:String(e.message||e)});}});
const ACTIVE_SIGNAL_MS=30*60*1000;
function enrichAlert(a){const ageMs=Date.now()-new Date(a.ts).getTime();const ageMinutes=Number.isFinite(ageMs)?Math.max(0,ageMs/60000):null;const active=ageMinutes!=null&&ageMs>=0&&ageMs<=ACTIVE_SIGNAL_MS;return{...a,active,age_minutes:ageMinutes==null?null:+ageMinutes.toFixed(1),valid_until:active?new Date(new Date(a.ts).getTime()+ACTIVE_SIGNAL_MS).toISOString():null};}
app.get("/api/alerts",async(req,res)=>{const {data,error}=await db.from("gn_alerts").select("*").order("ts",{ascending:false}).limit(50);if(error)return res.status(500).json({error:error.message});res.json((data||[]).map(enrichAlert));});
app.get("/api/portfolio",async(req,res)=>{try{res.json(await loadPortfolio());}catch(e){res.status(500).json({error:String(e.message||e)});}});
app.get("/api/runs",async(req,res)=>{const {data,error}=await db.from("gn_runs").select("*").order("started_at",{ascending:false}).limit(30);if(error)return res.status(500).json({error:error.message});res.json(data);});
app.get("/api/pre-pump/latest",createLatestPrePumpHandler({db}));

const FOCUS_UNIVERSE={
  us:[
    {symbol:"IREN",name:"IREN",theme:"AI 데이터센터·크립토 인프라",description:"대규모 전력 기반 데이터센터를 운영하며 비트코인 채굴과 AI 클라우드 인프라를 병행"},
    {symbol:"AVGO",name:"Broadcom",theme:"반도체·AI 네트워킹",description:"AI 가속기 연결용 네트워크·커스텀 반도체와 인프라 소프트웨어를 공급"},
    {symbol:"VRT",name:"Vertiv",theme:"AI 전력·냉각",description:"데이터센터용 전력관리·UPS·열관리와 냉각 인프라를 공급"},
    {symbol:"MNDY",name:"monday.com",theme:"AI 소프트웨어",description:"기업용 업무관리·워크플로 자동화 소프트웨어를 제공"}
  ],
  kr:[
    {symbol:"000660.KS",ticker:"000660",name:"SK하이닉스",theme:"AI 메모리·HBM",description:"AI 가속기에 쓰이는 HBM과 DRAM·NAND를 생산"},
    {symbol:"267260.KS",ticker:"267260",name:"HD현대일렉트릭",theme:"전력망·변압기",description:"변압기·차단기 등 초고압 전력기기를 생산"},
    {symbol:"010120.KS",ticker:"010120",name:"LS ELECTRIC",theme:"전력망·스마트그리드",description:"배전·자동화·스마트그리드와 전력기기를 공급"}
  ],
  safe:[
    {symbol:"GLD",name:"SPDR Gold Shares",theme:"금·안전자산",description:"금 현물 가격을 추종하는 대형 금 ETF"},
    {symbol:"IAU",name:"iShares Gold Trust",theme:"금·안전자산",description:"금 현물 가격을 추종하는 금 ETF"}
  ]
};
let focusCache={at:0,data:null};
async function yahooDaily(symbol){
  const ac=new AbortController();const timer=setTimeout(()=>ac.abort(),8000);
  try{
    const url="https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol)+"?range=1mo&interval=1d";
    const r=await fetch(url,{signal:ac.signal,headers:{"User-Agent":"Mozilla/5.0","accept":"application/json"}});
    if(!r.ok)throw new Error("Yahoo "+r.status);
    const j=await r.json();const x=j?.chart?.result?.[0];if(!x)throw new Error("Yahoo empty");
    const q=x.indicators?.quote?.[0]||{};const closes=q.close||[],volumes=q.volume||[];
    const rows=closes.map((c,i)=>({c:Number(c),v:Number(volumes[i])})).filter(z=>Number.isFinite(z.c)&&z.c>0);
    if(rows.length<3)throw new Error("insufficient daily rows");
    return rows;
  }finally{clearTimeout(timer);}
}
function focusSummary(meta,rows){
  const last=rows.at(-1),prev=rows.at(-2),prev5=rows[Math.max(0,rows.length-6)];
  const r1=prev?.c?last.c/prev.c-1:null,r5=prev5?.c?last.c/prev5.c-1:null;
  const hist=rows.slice(Math.max(0,rows.length-6),-1).map(x=>x.v).filter(Number.isFinite);
  const avgV=hist.length?hist.reduce((a,b)=>a+b,0)/hist.length:null;
  const volRatio=avgV&&Number.isFinite(last.v)?last.v/avgV:null;
  const score=(r5??0)*100*0.55+(r1??0)*100*0.30+((volRatio??1)-1)*8;
  let flow="중립",flowClass="warn";
  if((r5??0)>0.02&&(volRatio??1)>=1.05){flow="가격·거래량 유입 강화";flowClass="good";}
  else if((r5??0)<-0.02&&(volRatio??1)>=1.05){flow="가격·거래량 이탈 우세";flowClass="bad";}
  return {...meta,price:last.c,r1,r5,volumeRatio:volRatio,score:+score.toFixed(3),flow,flowClass};
}
async function focusGroup(items){
  const settled=await Promise.all(items.map(async meta=>{try{return focusSummary(meta,await yahooDaily(meta.symbol));}catch(error){return {...meta,error:String(error.message||error)};}}));
  const valid=settled.filter(x=>Number.isFinite(x.score)).sort((a,b)=>b.score-a.score);
  return {winner:valid[0]||null,all:settled};
}
app.get("/api/focus-candidates",async(req,res)=>{
  try{
    if(focusCache.data&&Date.now()-focusCache.at<5*60*1000)return res.json(focusCache.data);
    const [us,kr,safeGroup]=await Promise.all([focusGroup(FOCUS_UNIVERSE.us),focusGroup(FOCUS_UNIVERSE.kr),focusGroup(FOCUS_UNIVERSE.safe)]);
    const data={ts:new Date().toISOString(),method:"최근 1일·5일 가격과 최근 거래량을 합친 흐름 프록시",us,kr,safe:safeGroup};
    focusCache={at:Date.now(),data};res.json(data);
  }catch(e){res.status(500).json({error:String(e.message||e)});}
});

app.get("/",(req,res)=>res.type("html").send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>GN PIVOT · 투자비서</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#080a0d;color:#eef2f6;font-family:system-ui,-apple-system,sans-serif}.wrap{max-width:820px;margin:auto;padding:14px 14px 50px}.top{display:flex;justify-content:space-between;gap:10px;align-items:center}.title{font-size:22px;font-weight:950}.muted{color:#8996a3;font-size:12px}.topActions{display:flex;gap:7px}.topActions button,.logout{background:#171d24;border:1px solid #303b47;color:#dce4ec;border-radius:9px;padding:8px 10px;font-size:12px;text-decoration:none}.hero{margin-top:12px;background:#11161c;border:1px solid #34404c;border-radius:18px;padding:17px}.heroTop{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.eyebrow{font-size:11px;color:#8996a3;font-weight:800}.direction{font-size:26px;font-weight:950;line-height:1.15;margin-top:3px}.action{font-size:17px;font-weight:900;margin-top:7px}.good{color:#5ada91}.warn{color:#ffd166}.bad{color:#ff7272}.neutral{color:#b7c1cb}.score{font-size:12px;color:#a8b4c0;text-align:right}.thesis{margin-top:12px;padding-top:11px;border-top:1px solid #27313b;font-size:13px;line-height:1.55;color:#c3ccd5}.section{margin-top:18px}.sectionTitle{display:flex;justify-content:space-between;align-items:end;margin:0 2px 8px}.sectionTitle b{font-size:15px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.card{background:#11161c;border:1px solid #27313b;border-radius:14px;padding:13px}.cardName{font-size:12px;color:#9eabb7;font-weight:800}.cardAction{font-size:18px;font-weight:950;margin-top:5px}.cardMeta{font-size:11px;color:#7f8c98;margin-top:5px;line-height:1.4}.assetGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.asset{display:flex;justify-content:space-between;gap:10px;align-items:center;background:#11161c;border:1px solid #27313b;border-radius:14px;padding:12px}.assetName{font-weight:900}.assetSub{font-size:11px;color:#84919d;margin-top:3px}.assetAct{font-size:13px;font-weight:900;text-align:right}.top3{display:grid;gap:8px}.pick{display:grid;grid-template-columns:32px 1fr auto;gap:10px;align-items:start;background:#11161c;border:1px solid #27313b;border-radius:14px;padding:12px}.rank{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#202833;font-weight:900}.pickName{font-size:16px;font-weight:950}.pickMeta{font-size:11px;color:#8f9ca8;line-height:1.45;margin-top:3px}.stage{display:inline-block;padding:3px 7px;border:1px solid #3b4856;border-radius:999px;font-size:10px;margin-top:6px}.pickAct{font-size:14px;font-weight:950;text-align:right}.empty{background:#11161c;border:1px solid #27313b;border-radius:14px;padding:14px;color:#8e9aa6}.foot{margin-top:20px;color:#66727d;text-align:center;font-size:10px}@media(max-width:620px){.cards{grid-template-columns:1fr}.assetGrid{grid-template-columns:1fr}.direction{font-size:24px}.pick{grid-template-columns:30px 1fr}.pickAct{grid-column:2;text-align:left}.heroTop{display:block}.score{text-align:left;margin-top:8px}}
</style></head><body><div class="wrap"><div class="top"><div><div class="title">GN PIVOT</div><div class="muted" id="updated">불러오는 중…</div></div><div class="topActions"><button onclick="loadAll()">새로고침</button><a class="logout" href="/logout">로그아웃</a></div></div><div class="hero" id="hero"></div>
<div class="section"><div class="sectionTitle"><b>오늘 판단</b><span class="muted">시장 → 자금 → 후보</span></div><div class="cards" id="actions"></div></div>
<div class="section"><div class="sectionTitle"><b>자산군별 집중 후보 · 각 1개</b><span class="muted">미국주식 · 한국주식 · 크립토 · 금/안전자산</span></div><div class="assetGrid" id="focus"></div></div>
<div class="section"><div class="sectionTitle"><b>핵심 크립토 추적</b><span class="muted">BTC · ETH 실시간 엔진</span></div><div class="assetGrid" id="assets"></div></div>
<div class="section"><div class="sectionTitle"><b>돈의 발자국</b><span class="muted">장기채 · 유가/디젤 · 유동성 · 달러/환율 변화와 연결</span></div><div class="cards" id="footprints"></div></div>
<div class="section"><div class="sectionTitle"><b>Pre-Pump TOP3</b><span class="muted">원본 ENTRY/관리 상태</span></div><div class="top3" id="top3"></div></div>
<div class="foot">자산군별 1개 · 후보가 없으면 비워둔다 · 강제 TOP3 금지 · 추격보다 선행탐지 우선</div></div><script>
const f=x=>Number.isFinite(Number(x))?Number(x).toFixed(1):'-';const n=x=>x==null?'':Number(x).toLocaleString();
async function safe(url){const r=await fetch(url);if(r.status===401){location.href='/login';throw new Error('로그인이 필요합니다');}if(!r.ok)throw new Error(await r.text());return r.json();}
function clsFromAction(raw,score){const s=String(raw||'').toUpperCase();if(s.includes('매수금지')||s.includes('NO_CHASE')||s.includes('SELL')||s.includes('EXIT')||s.includes('청산')||s.includes('물타기금지'))return'bad';if(s.includes('추가매수')||s.includes('확인매수')||s.includes('ENTRY')||s.includes('BUY')||s.includes('진입')||s.includes('익절')||s.includes('러너유지'))return'good';const v=Number(score);if(Number.isFinite(v)&&v<35)return'bad';if(Number.isFinite(v)&&v>=65)return'good';return'warn';}
function direction(d){const s=Number(d?.score)||50;if(s<35)return['위험 회피 우세','현금 우선 · 신규매수 중단','bad'];if(s<50)return['조정 우세','추격 금지 · 현금 유지','warn'];if(s<65)return['중립 / 방향 탐색','선발대만 · 확인 후 확대','warn'];return['위험선호 우세','분할매수 가능 · 과열 추격 금지','good'];}
function hero(m){const d=m?.decision||{};const [dir,act,cl]=direction(d);const ai=d?.aiApplied?'AI 합의 반영':'시장 데이터 기준';return '<div class="heroTop"><div><div class="eyebrow">2~6주 기본 방향</div><div class="direction '+cl+'">'+dir+'</div><div class="action">'+act+'</div></div><div class="score">시장점수 '+f(d.score)+'<br>'+ai+'</div></div><div class="thesis">운용 원금 20,000,000원 · 자산군별 후보는 각각 1개만 표시. 고정 배분은 하지 않고, 장기채·유가/디젤·유동성·달러/환율과 실제 가격·거래량 흐름이 확인될 때만 분할 투입. 가격이 흔들렸다는 이유만으로 사전 시나리오를 뒤집지 않는다.</div>';}
function actionCards(m){const d=m?.decision||{};const [dir,act,cl]=direction(d);return '<div class="card"><div class="cardName">시장</div><div class="cardAction '+cl+'">'+dir+'</div><div class="cardMeta">'+act+'</div></div><div class="card"><div class="cardName">신규자금</div><div class="cardAction '+(cl==='good'?'good':'warn')+'">'+(cl==='good'?'1차 분할':'현금 유지')+'</div><div class="cardMeta">전액 투입 금지 · 다음 조정 여력 남김</div></div><div class="card"><div class="cardName">멘탈 기준</div><div class="cardAction neutral">추격 안 함</div><div class="cardMeta">오르면 놓친 게 아니라 계획대로 대기</div></div>';}
function assets(latest,m){const by={};for(const r of latest||[])by[String(r.coin||'').toUpperCase()]=r;function row(name,sub,text,c){return '<div class="asset"><div><div class="assetName">'+name+'</div><div class="assetSub">'+sub+'</div></div><div class="assetAct '+c+'">'+text+'</div></div>';}
const btc=by.BTC,eth=by.ETH;return row('BTC',btc?.krw_price!=null?n(btc.krw_price)+'원':'가격 확인 중',clsFromAction(btc?.stage,btc?.score)==='good'?'구조 유지':'대기',clsFromAction(btc?.stage,btc?.score))+row('ETH',eth?.krw_price!=null?n(eth.krw_price)+'원':'가격 확인 중',clsFromAction(eth?.stage,eth?.score)==='good'?'구조 유지':'대기',clsFromAction(eth?.stage,eth?.score));}
function pctText(x){return Number.isFinite(Number(x))?(Number(x)*100).toFixed(1)+'%':'-';}
function priceText(x,currency){if(!Number.isFinite(Number(x)))return'-';return currency==='KRW'?Math.round(Number(x)).toLocaleString()+'원':'const d=m?.decision||{};const reasons=d.reasons||[];const ai=m?.ai;const aiTxt=ai?.eligible?(ai.sentiment==='risk_on'?'위험선호':ai.sentiment==='risk_off'?'위험회피':'중립'):'표본부족';return '<div class="card"><div class="cardName">유동성/시장폭</div><div class="cardAction '+clsFromAction(d.action,d.score)+'">'+(d.regime||'확인 중')+'</div><div class="cardMeta">시장점수 '+f(d.score)+'</div></div><div class="card"><div class="cardName">AI 5개 합의</div><div class="cardAction neutral">'+aiTxt+'</div><div class="cardMeta">'+(ai?.successCount||0)+'/5 · 신뢰도 '+(ai?.confidence!=null?Math.round(ai.confidence*100)+'%':'-')+'</div></div><div class="card"><div class="cardName">현재 핵심 근거</div><div class="cardAction neutral">'+(reasons[0]?'유지':'관찰')+'</div><div class="cardMeta">'+(reasons[0]||'새 선행 변화 없음')+'</div></div>';}
function top3Cards(rows){const top=(rows||[]).slice(0,3);if(!top.length)return '<div class="empty">현재 유효 후보 없음 — 억지로 3개를 채우지 않음</div>';return top.map((r,i)=>{const name=String(r.market||r.coin||'').replace('KRW-','');const action=String(r.action||'관찰');const status=String(r.status||r.scannerStatus||'');const c=clsFromAction(action,r.score);return '<div class="pick"><div class="rank">'+(r.rank||i+1)+'</div><div><div class="pickName">'+name+'</div><div class="pickMeta">현재 '+(r.krwPrice!=null?n(r.krwPrice)+'원':'-')+' · 최초/진입 '+(r.recommendedEntry!=null?n(r.recommendedEntry)+'원':'-')+' · 점수 '+f(r.score)+'</div><span class="stage">'+status+'</span></div><div class="pickAct '+c+'">'+action+'</div></div>';}).join('');}
async function loadAll(){try{const [market,latest,prePump,focus]=await Promise.all([safe('/api/market/live'),safe('/api/latest'),safe('/api/pre-pump/latest').catch(()=>[]),safe('/api/focus-candidates').catch(()=>null)]);document.getElementById('hero').innerHTML=hero(market);document.getElementById('actions').innerHTML=actionCards(market);document.getElementById('focus').innerHTML=focusCandidates(focus,prePump);document.getElementById('assets').innerHTML=assets(latest,market);document.getElementById('footprints').innerHTML=footprints(market);document.getElementById('top3').innerHTML=top3Cards(prePump);document.getElementById('updated').textContent='업데이트 '+new Date(market.ts||Date.now()).toLocaleString()+' · 60초 자동';}catch(e){document.getElementById('updated').textContent='오류: '+e.message;document.getElementById('hero').innerHTML='<div class="direction bad">데이터 오류</div><div class="action">신규매수 중단 · 엔진 복구 우선</div>';}}
loadAll();setInterval(loadAll,60000);
</script></body></html>`));

const port=process.env.PORT||10000;app.listen(port,()=>console.log("GN investment assistant dashboard listening",port));+Number(x).toFixed(2);}
function focusCandidates(fc,prePump){function box(label,x,currency){if(!x)return '<div class="asset"><div><div class="assetName">'+label+'</div><div class="assetSub">데이터 연결 실패 · 후보 보류</div></div><div class="assetAct warn">대기</div></div>';const ticker=x.ticker||x.symbol;return '<div class="asset"><div><div class="assetName">'+label+' · '+ticker+' · '+x.name+'</div><div class="assetSub">'+x.theme+' · '+x.description+'<br>현재 '+priceText(x.price,currency)+' · 1일 '+pctText(x.r1)+' · 5일 '+pctText(x.r5)+' · 거래량 '+(Number.isFinite(Number(x.volumeRatio))?Number(x.volumeRatio).toFixed(2)+'배':'-')+'</div></div><div class="assetAct '+(x.flowClass||'warn')+'">'+(x.flow||'관찰')+'</div></div>';}
const crypto=(prePump||[])[0];const cryptoBox=crypto?'<div class="asset"><div><div class="assetName">크립토 · '+String(crypto.market||crypto.coin||'').replace('KRW-','')+'</div><div class="assetSub">Pre-Pump 선행탐지 · 현재 '+(crypto.krwPrice!=null?n(crypto.krwPrice)+'원':'-')+' · 점수 '+f(crypto.score)+' · '+String(crypto.status||crypto.scannerStatus||'')+'</div></div><div class="assetAct '+clsFromAction(crypto.action,crypto.score)+'">'+String(crypto.action||'관찰')+'</div></div>':'<div class="asset"><div><div class="assetName">크립토</div><div class="assetSub">현재 유효 후보 없음 · 강제 선발 안 함</div></div><div class="assetAct warn">대기</div></div>';
return box('미국주식',fc?.us?.winner,'USD')+box('한국주식',fc?.kr?.winner,'KRW')+cryptoBox+box('금/안전자산',fc?.safe?.winner,'USD');}
function footprints(m){const d=m?.decision||{};const reasons=d.reasons||[];const ai=m?.ai;const aiTxt=ai?.eligible?(ai.sentiment==='risk_on'?'위험선호':ai.sentiment==='risk_off'?'위험회피':'중립'):'표본부족';return '<div class="card"><div class="cardName">유동성/시장폭</div><div class="cardAction '+clsFromAction(d.action,d.score)+'">'+(d.regime||'확인 중')+'</div><div class="cardMeta">시장점수 '+f(d.score)+'</div></div><div class="card"><div class="cardName">AI 5개 합의</div><div class="cardAction neutral">'+aiTxt+'</div><div class="cardMeta">'+(ai?.successCount||0)+'/5 · 신뢰도 '+(ai?.confidence!=null?Math.round(ai.confidence*100)+'%':'-')+'</div></div><div class="card"><div class="cardName">현재 핵심 근거</div><div class="cardAction neutral">'+(reasons[0]?'유지':'관찰')+'</div><div class="cardMeta">'+(reasons[0]||'새 선행 변화 없음')+'</div></div>';}
function top3Cards(rows){const top=(rows||[]).slice(0,3);if(!top.length)return '<div class="empty">현재 유효 후보 없음 — 억지로 3개를 채우지 않음</div>';return top.map((r,i)=>{const name=String(r.market||r.coin||'').replace('KRW-','');const action=String(r.action||'관찰');const status=String(r.status||r.scannerStatus||'');const c=clsFromAction(action,r.score);return '<div class="pick"><div class="rank">'+(r.rank||i+1)+'</div><div><div class="pickName">'+name+'</div><div class="pickMeta">현재 '+(r.krwPrice!=null?n(r.krwPrice)+'원':'-')+' · 최초/진입 '+(r.recommendedEntry!=null?n(r.recommendedEntry)+'원':'-')+' · 점수 '+f(r.score)+'</div><span class="stage">'+status+'</span></div><div class="pickAct '+c+'">'+action+'</div></div>';}).join('');}
async function loadAll(){try{const [market,latest,prePump]=await Promise.all([safe('/api/market/live'),safe('/api/latest'),safe('/api/pre-pump/latest').catch(()=>[])]);document.getElementById('hero').innerHTML=hero(market);document.getElementById('actions').innerHTML=actionCards(market);document.getElementById('assets').innerHTML=assets(latest,market);document.getElementById('footprints').innerHTML=footprints(market);document.getElementById('top3').innerHTML=top3Cards(prePump);document.getElementById('updated').textContent='업데이트 '+new Date(market.ts||Date.now()).toLocaleString()+' · 60초 자동';}catch(e){document.getElementById('updated').textContent='오류: '+e.message;document.getElementById('hero').innerHTML='<div class="direction bad">데이터 오류</div><div class="action">신규매수 중단 · 엔진 복구 우선</div>';}}
loadAll();setInterval(loadAll,60000);
</script></body></html>`));

const port=process.env.PORT||10000;app.listen(port,()=>console.log("GN investment assistant dashboard listening",port));