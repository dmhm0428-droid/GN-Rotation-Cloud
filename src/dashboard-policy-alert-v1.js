"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");

const PANEL=`<section id="policyEarlyWarning" style="margin-top:14px;background:#11161c;border:1px solid #2d3945;border-radius:16px;padding:16px">
<div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><div><div style="font-size:12px;color:#97a4b0;font-weight:800">정책·유동성 선행경보</div><div id="policyStage" style="font-size:25px;font-weight:950;margin-top:4px">WATCH</div></div><div id="policyClock" style="font-size:11px;color:#8794a2;text-align:right">실시간 확인 중</div></div>
<div id="policyReason" style="margin-top:7px;color:#c7d0d8;font-size:13px">정책/유동성 + 시장 확인이 겹칠 때만 단계 상승</div>
<div id="policyGrid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:12px"></div>
<div style="margin-top:12px;padding-top:10px;border-top:1px solid #27313b;font-size:11px;color:#8794a2;line-height:1.55">WATCH 정책·국채 방어 흔적 → READY 금리·유가·달러/유동성 개선 → ARMED 스테이블코인·BTC 현물 개선 + ETH/BTC↑ + BTC.D↓ + 알트 시장폭 확산. 가격 급등만으로 단계 상승 금지.</div>
</section>`;
const SCRIPT=`<script id="gn-policy-early-warning-v1">(function(){
const n=v=>Number(v),ok=v=>Number.isFinite(n(v)),cl=(x,a,b)=>Math.max(a,Math.min(b,x));
function box(k,v,s){return '<div style="background:#0c1116;border:1px solid #27313b;border-radius:12px;padding:10px"><div style="font-size:11px;color:#8f9ca8">'+k+'</div><div style="font-size:16px;font-weight:900;margin-top:3px">'+v+'</div><div style="font-size:10px;color:#75828e;margin-top:2px">'+s+'</div></div>'}
async function loadPolicy(){try{const r=await fetch('/api/live-summary?t='+Date.now(),{cache:'no-store'});if(!r.ok)return;const d=await r.json(),m=d.market||{},mc=d.macro||{};
const breadth=ok(m.spot_breadth100)?n(m.spot_breadth100)*100:null,btc=ok(m.btc_taker_ratio)?n(m.btc_taker_ratio):null,eth=ok(m.eth_taker_ratio)?n(m.eth_taker_ratio):null;
const rates=ok(mc.rates_score)?n(mc.rates_score):null,fx=ok(mc.usd_fx_score)?n(mc.usd_fx_score):null,liq=ok(mc.liquidity_score)?n(mc.liquidity_score):null,com=ok(mc.commodities_score)?n(mc.commodities_score):null;
const policy=(liq!=null&&liq>=55)||(rates!=null&&rates>=55);const macro=[rates,fx,com].filter(x=>x!=null&&x>=55).length>=2;const spot=(btc!=null&&btc>=1)||(eth!=null&&eth>=1);const rotation=(breadth!=null&&breadth>=55)&&(eth!=null&&eth>=1);
let stage='WATCH',reason='정책·국채시장 방어 흔적만 감시';if(policy&&macro){stage='READY';reason='거시/유동성 개선 동시 확인';}if(policy&&macro&&spot&&rotation){stage='ARMED';reason='유동성 + 현물수급 + 알트 시장폭 동시 확인';}
const e=document.getElementById('policyStage'),q=document.getElementById('policyReason'),g=document.getElementById('policyGrid'),c=document.getElementById('policyClock');if(e)e.textContent=stage;if(q)q.textContent=reason;if(c)c.textContent=new Date().toLocaleTimeString()+' · 15초';if(g)g.innerHTML=box('금리',rates==null?'--':rates.toFixed(1),'55↑ 개선')+box('달러FX',fx==null?'--':fx.toFixed(1),'55↑ 압력완화')+box('유동성',liq==null?'--':liq.toFixed(1),'55↑ 개선')+box('원자재/유가',com==null?'--':com.toFixed(1),'55↑ 개선')+box('BTC / ETH 체결',(btc==null?'--':btc.toFixed(2))+' / '+(eth==null?'--':eth.toFixed(2)),'1.00↑ 현물 우위')+box('알트 시장폭',breadth==null?'--':breadth.toFixed(1)+'%','55%↑ 확산');
}catch(_){}}
setTimeout(loadPolicy,400);setInterval(loadPolicy,15000);})();</script>`;
function patch(html){if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes('policyEarlyWarning'))return html;const hero=html.indexOf('<div class="hero">');if(hero<0)return html;return html.slice(0,hero)+PANEL+html.slice(hero).replace('</body>',SCRIPT+'</body>');}
function wrappedExpress(...args){const app=previousExpress(...args);app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patch(body))};next()});return app;}
Object.assign(wrappedExpress,previousExpress);require.cache[expressPath].exports=wrappedExpress;
