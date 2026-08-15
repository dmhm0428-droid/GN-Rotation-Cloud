
const express=require("express");
const {createClient}=require("@supabase/supabase-js");
const app=express();

const URL=process.env.SUPABASE_URL, KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!URL||!KEY)throw new Error("Supabase env vars missing");
const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const USER=process.env.DASHBOARD_USER||"gn";
const PASS=process.env.DASHBOARD_PASSWORD;
if(!PASS)throw new Error("DASHBOARD_PASSWORD is required");

function auth(req,res,next){
  const h=req.headers.authorization||"";
  if(!h.startsWith("Basic "))return challenge(res);
  try{
    const [u,p]=Buffer.from(h.slice(6),"base64").toString().split(":");
    if(u===USER&&p===PASS)return next();
  }catch{}
  return challenge(res);
}
function challenge(res){
  res.set("WWW-Authenticate",'Basic realm="GN Rotation"');
  return res.status(401).send("Authentication required");
}
app.get("/health",(req,res)=>res.json({ok:true,time:new Date().toISOString()}));
app.use(auth);
app.use(express.json());

app.get("/api/latest",async(req,res)=>{
  const {data,error}=await db.from("gn_snapshots").select("*").order("ts",{ascending:false}).limit(20);
  if(error)return res.status(500).json({error:error.message});
  const latest={};
  for(const r of data||[])if(!latest[r.coin])latest[r.coin]=r;
  res.json(Object.values(latest).sort((a,b)=>(a.rank||99)-(b.rank||99)));
});
app.get("/api/history",async(req,res)=>{
  const coin=String(req.query.coin||"BTC").toUpperCase();
  const hours=Math.min(168,Math.max(1,+req.query.hours||24));
  const since=new Date(Date.now()-hours*3600*1000).toISOString();
  const {data,error}=await db.from("gn_snapshots")
    .select("ts,coin,score,stage,rank,krw_price,rs4,rs24,cvd15,oi15,oi1h,funding,btc_dominance,delta_score15,data_quality")
    .eq("coin",coin).gte("ts",since).order("ts",{ascending:true});
  if(error)return res.status(500).json({error:error.message});
  res.json(data);
});
app.get("/api/alerts",async(req,res)=>{
  const {data,error}=await db.from("gn_alerts").select("*").order("ts",{ascending:false}).limit(50);
  if(error)return res.status(500).json({error:error.message});
  res.json(data);
});
app.get("/api/runs",async(req,res)=>{
  const {data,error}=await db.from("gn_runs").select("*").order("started_at",{ascending:false}).limit(30);
  if(error)return res.status(500).json({error:error.message});
  res.json(data);
});

app.get("/",async(req,res)=>{
  res.type("html").send(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GN Rotation</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#0b0d10;color:#eef2f6}
.wrap{max-width:980px;margin:auto;padding:16px}.top{display:flex;justify-content:space-between;align-items:center;gap:10px}
h1{font-size:22px}.muted{color:#9aa6b2}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.card{background:#15191f;border:1px solid #29313a;border-radius:14px;padding:14px}.rank{font-size:12px;color:#9aa6b2}
.coin{font-size:24px;font-weight:750}.score{font-size:27px;font-weight:800}.stage{font-weight:700}
.row{display:flex;justify-content:space-between;gap:10px;margin-top:7px;font-size:13px}
.good{color:#57d38c}.warn{color:#ffc857}.bad{color:#ff6b6b}
table{width:100%;border-collapse:collapse;font-size:12px}td,th{padding:8px;border-bottom:1px solid #27303a;text-align:left}
button{background:#222933;color:white;border:1px solid #3a4654;padding:8px 12px;border-radius:9px}
</style></head>
<body><div class="wrap">
<div class="top"><div><h1>GN Rotation Cloud</h1><div class="muted" id="updated">불러오는 중…</div></div><button onclick="load()">새로고침</button></div>
<div class="grid" id="cards"></div>
<h2>최근 알림</h2><div class="card"><table><thead><tr><th>시간</th><th>코인</th><th>단계</th><th>내용</th></tr></thead><tbody id="alerts"></tbody></table></div>
</div>
<script>
const p=x=>x==null?"N/A":(Number(x)*100).toFixed(2)+"%";
const n=x=>x==null?"N/A":Number(x).toLocaleString();
async function load(){
 const [lr,ar]=await Promise.all([fetch("/api/latest"),fetch("/api/alerts")]);
 const latest=await lr.json(), alerts=await ar.json();
 document.getElementById("updated").textContent=latest[0]?.ts?("최근 수집 "+new Date(latest[0].ts).toLocaleString()):"데이터 없음";
 document.getElementById("cards").innerHTML=latest.map(r=>\`
 <div class="card"><div class="rank">\${r.rank||"-"}위 · 품질 \${Math.round((r.data_quality||0)*100)}%</div>
 <div class="coin">\${r.coin}</div><div class="score">\${Number(r.score).toFixed(2)}</div>
 <div class="stage \${r.stage==="본회전"||r.stage==="선발대"?"good":r.stage==="과열"?"bad":"warn"}">\${r.stage}</div>
 <div class="row"><span>원화</span><b>\${n(r.krw_price)}</b></div>
 <div class="row"><span>ΔScore15</span><b>\${r.delta_score15==null?"N/A":Number(r.delta_score15).toFixed(2)}</b></div>
 <div class="row"><span>RS 4h / 24h</span><b>\${p(r.rs4)} / \${p(r.rs24)}</b></div>
 <div class="row"><span>CVD15</span><b>\${p(r.cvd15)}</b></div>
 <div class="row"><span>OI 15m / 1h</span><b>\${p(r.oi15)} / \${p(r.oi1h)}</b></div>
 <div class="row"><span>Funding</span><b>\${p(r.funding)}</b></div>
 <div class="row"><span>BTC Dom</span><b>\${Number(r.btc_dominance||0).toFixed(2)}%</b></div></div>\`).join("");
 document.getElementById("alerts").innerHTML=(alerts||[]).slice(0,20).map(a=>\`<tr><td>\${new Date(a.ts).toLocaleString()}</td><td>\${a.coin}</td><td>\${a.stage||a.level}</td><td>\${a.message}</td></tr>\`).join("");
}
load(); setInterval(load,60000);
</script></body></html>`);
});

const port=process.env.PORT||10000;
app.listen(port,()=>console.log("GN dashboard listening",port));
