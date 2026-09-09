"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");

const STOCK_SECTION='<div class="section" id="usStockFootprintSection"><div class="head"><b>미국주식 발자국</b><span class="muted">실제 자금흐름 상위 3</span></div><div id="usStockFlow" class="grid"></div></div>';
const CLIENT=`<script id="gn-us-stock-footprint-v1">(function(){
const $=id=>document.getElementById(id),num=v=>Number(v),ok=v=>Number.isFinite(num(v)),f=v=>ok(v)?num(v).toFixed(1):'--',usd=v=>ok(v)?'$'+num(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'--',esc=v=>String(v==null?'':v).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const sectorKo={Technology:'기술/AI',Energy:'에너지',Communication:'커뮤니케이션',Consumer_Discretionary:'경기소비재',Consumer_Staples:'필수소비재',Healthcare:'헬스케어',Financials:'금융',Materials:'소재',Industrials:'산업재',Real_Estate:'부동산',Utilities:'유틸리티'};
async function loadStockFootprints(){const box=$('usStockFlow');if(!box)return;try{const r=await fetch('/api/live-summary?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json();const rows=(d.reps||[]).filter(x=>String(x.asset_class||'').toUpperCase()==='STOCK'&&ok(x.flow_score)).sort((a,b)=>num(b.flow_score)-num(a.flow_score)).slice(0,3);box.innerHTML=rows.length?rows.map((x,i)=>'<div class="card"><div class="name">#'+(i+1)+' '+esc(x.symbol||'--')+' · '+esc(sectorKo[x.sector]||String(x.sector||'미국주식').replaceAll('_',' '))+'</div><div class="value">자금 '+f(x.flow_score)+'</div><div class="meta">RS '+f(x.relative_strength)+' · 기술 '+f(x.technical_score)+' · '+usd(x.price)+'</div></div>').join(''):'<div class="empty">미국주식 자금흐름 데이터 없음</div>';}catch(e){box.innerHTML='<div class="empty">미국주식 발자국 재조회 중</div>';}}
setTimeout(loadStockFootprints,150);setInterval(loadStockFootprints,15000);window.loadUSStockFootprints=loadStockFootprints;
})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("gn-us-stock-footprint-v1"))return html;
  let out=html.replace('<b>돈의 방향</b>','<b>돈의 발자국</b>');
  const anchor='<div id="assetFlow" class="grid"></div></div>';
  if(out.includes(anchor))out=out.replace(anchor,anchor+STOCK_SECTION);
  if(out.includes('</body>'))out=out.replace('</body>',CLIENT+'</body>');
  return out;
}
function wrappedExpress(...args){const app=previousExpress(...args);app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});return app;}
Object.assign(wrappedExpress,previousExpress);require.cache[expressPath].exports=wrappedExpress;
