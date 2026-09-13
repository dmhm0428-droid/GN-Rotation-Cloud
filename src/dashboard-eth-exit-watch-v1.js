"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");
const {createClient}=require("@supabase/supabase-js");
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
let cache={at:0,data:null};
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const stale=ts=>!ts||Date.now()-new Date(ts).getTime()>30*60*1000;
async function upbit(){
  const r=await fetch("https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH",{headers:{accept:"application/json","user-agent":"GN-PIVOT/1.0"}});
  if(!r.ok)throw Error(`UPBIT_${r.status}`);
  const rows=await r.json(),m=Object.fromEntries(rows.map(x=>[x.market,x]));
  const b=m["KRW-BTC"]||{},e=m["KRW-ETH"]||{};
  const bp=n(b.trade_price),ep=n(e.trade_price),b0=n(b.prev_closing_price),e0=n(e.prev_closing_price);
  const ratio=bp&&ep?ep/bp:null,ratio0=b0&&e0?e0/b0:null;
  return {btcKrw:bp,ethKrw:ep,ethBtc:ratio,ethBtcChangePct:ratio&&ratio0?(ratio/ratio0-1)*100:null,btcChangePct:n(b.signed_change_rate)!=null?n(b.signed_change_rate)*100:null,ethChangePct:n(e.signed_change_rate)!=null?n(e.signed_change_rate)*100:null,ts:new Date(Math.max(n(b.timestamp)||0,n(e.timestamp)||0)).toISOString()};
}
async function btcDominance(){
  try{const r=await fetch("https://api.coingecko.com/api/v3/global",{headers:{accept:"application/json","user-agent":"GN-PIVOT/1.0"}});if(!r.ok)return null;const j=await r.json();return n(j?.data?.market_cap_percentage?.btc);}catch{return null;}
}
async function latest(table,cols){const {data,error}=await db.from(table).select(cols).order("ts",{ascending:false}).limit(1).maybeSingle();if(error)throw error;return data||null;}
async function ethExitWatch(req,res){
  try{
    if(cache.data&&Date.now()-cache.at<12000){res.set("Cache-Control","no-store");return res.json(cache.data);}
    const [q,market,macro,dom]=await Promise.all([upbit(),latest("gn_market_snapshots","ts,spot_breadth100,btc_taker_ratio,eth_taker_ratio"),latest("gn_macro_regime","ts,rates_score,commodities_score,usd_fx_score,liquidity_score"),btcDominance()]);
    const fresh=!stale(market?.ts)&&!stale(macro?.ts),signals=[];
    const add=(key,label,bad,value)=>signals.push({key,label,bad:!!bad,value});
    add("ethbtc","ETH/BTC",q.ethBtcChangePct!=null&&q.ethBtcChangePct<0,q.ethBtcChangePct);
    add("breadth","알트 시장폭",n(market?.spot_breadth100)!=null&&n(market.spot_breadth100)<0.45,n(market?.spot_breadth100)!=null?n(market.spot_breadth100)*100:null);
    add("btcTaker","BTC 체결수급",n(market?.btc_taker_ratio)!=null&&n(market.btc_taker_ratio)<1,n(market?.btc_taker_ratio));
    add("ethTaker","ETH 체결수급",n(market?.eth_taker_ratio)!=null&&n(market.eth_taker_ratio)<1,n(market?.eth_taker_ratio));
    add("rates","미국 금리환경",n(macro?.rates_score)!=null&&n(macro.rates_score)<45,n(macro?.rates_score));
    add("oil","유가/원자재환경",n(macro?.commodities_score)!=null&&n(macro.commodities_score)<45,n(macro?.commodities_score));
    const riskCount=fresh?signals.filter(x=>x.bad).length:0;
    const status=!fresh?"DATA STALE":riskCount>=3?"하방 위험 강화":riskCount>=2?"매도준비 선행경보":"대기";
    const data={ts:new Date().toISOString(),status,riskCount,fresh,ethKrw:q.ethKrw,btcKrw:q.btcKrw,ethChangePct:q.ethChangePct,btcChangePct:q.btcChangePct,ethBtc:q.ethBtc,ethBtcChangePct:q.ethBtcChangePct,btcDominance:dom,signals,sourceTs:{upbit:q.ts,market:market?.ts||null,macro:macro?.ts||null}};
    cache={at:Date.now(),data};res.set("Cache-Control","no-store");res.json(data);
  }catch(e){res.set("Cache-Control","no-store");res.status(200).json({ts:new Date().toISOString(),status:"DATA STALE",riskCount:0,fresh:false,error:String(e?.message||e)});}
}
const EXTRA=`<style id="gn-eth-exit-style">#ethExitWrap{margin-top:10px}.exitCard{background:#11161c;border:1px solid #2d3945;border-radius:16px;padding:14px}.exitTop{display:flex;justify-content:space-between;gap:10px;align-items:center}.exitTitle{font-weight:900;font-size:16px}.exitStatus{font-size:15px;font-weight:950}.exitMeta{margin-top:7px;color:#9eabb7;font-size:12px;line-height:1.55}.exitSignals{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:10px}.exitSig{border:1px solid #29343f;border-radius:11px;padding:9px;font-size:11px}.exitSig b{display:block;font-size:12px;margin-bottom:3px}.exitBad{border-color:#7a3131}.exitGood{border-color:#28573c}@media(max-width:620px){.exitSignals{grid-template-columns:repeat(2,1fr)}}</style><div id="ethExitWrap" class="section"><div class="exitCard"><div class="exitTop"><div class="exitTitle">ETH 매도시점 선행감시</div><div id="ethExitStatus" class="exitStatus">조회 중…</div></div><div id="ethExitMeta" class="exitMeta">가격이 깨진 뒤가 아니라 수급·거시 악화를 먼저 본다.</div><div id="ethExitSignals" class="exitSignals"></div></div></div><script id="gn-eth-exit-watch-v1">(function(){var box=document.getElementById('ethExitWrap');function vis(){var on=document.querySelector('.tab.on');if(box)box.style.display=(!on||on.dataset.tab==='crypto')?'block':'none'}function f(v,d){return Number.isFinite(Number(v))?Number(v).toFixed(d):'--'}async function load(){try{var r=await fetch('/api/eth-exit-watch?t='+Date.now(),{cache:'no-store'}),d=await r.json(),s=document.getElementById('ethExitStatus'),m=document.getElementById('ethExitMeta'),g=document.getElementById('ethExitSignals');if(s)s.textContent=d.status||'--';if(m)m.textContent='ETH '+(d.ethKrw?Number(d.ethKrw).toLocaleString()+'원':'--')+' · ETH/BTC '+f(d.ethBtc,5)+' ('+f(d.ethBtcChangePct,2)+'%) · BTC.D '+f(d.btcDominance,2)+'% · 위험 '+(d.riskCount??0)+'개';if(g)g.innerHTML=(d.signals||[]).map(function(x){return '<div class="exitSig '+(x.bad?'exitBad':'exitGood')+'"><b>'+(x.bad?'악화 · ':'확인 · ')+x.label+'</b>'+f(x.value,2)+'</div>'}).join('');}catch(e){var s=document.getElementById('ethExitStatus');if(s)s.textContent='DATA STALE'}}document.addEventListener('click',function(e){if(e.target&&e.target.classList&&e.target.classList.contains('tab'))setTimeout(vis,0)});vis();setTimeout(load,500);setInterval(load,15000)})();</script>`;
function patchHtml(html){if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("gn-eth-exit-watch-v1"))return html;const anchor='<div class="section"><div class="head"><b>Pre-Pump TOP3</b>';return html.includes(anchor)?html.replace(anchor,EXTRA+anchor):html.replace("</body>",EXTRA+"</body>");}
function wrappedExpress(...args){const app=previousExpress(...args);app.get("/api/eth-exit-watch",ethExitWatch);app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});return app;}
Object.assign(wrappedExpress,previousExpress);require.cache[expressPath].exports=wrappedExpress;
