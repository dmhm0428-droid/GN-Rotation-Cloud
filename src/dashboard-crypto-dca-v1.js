"use strict";

const expressPath=require.resolve("express");
const previousExpress=require("express");

const SCRIPT=`<script id="gn-crypto-dca-v1">(function(){
const levels={
  BTC:{base:105250000,rows:[[-5,100000000],[-10,94700000],[-15,89500000],[-20,84200000]]},
  ETH:{base:3430000,rows:[[-5,3260000],[-10,3090000],[-15,2920000],[-20,2740000]]}
};
function won(v){return Number(v).toLocaleString('ko-KR')+'원'}
function card(sym,o){return '<div style="background:#11161c;border:1px solid #27313b;border-radius:14px;padding:12px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b style="font-size:15px">'+sym+'</b><span style="font-size:11px;color:#8996a3">기준 '+won(o.base)+'</span></div><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-top:9px">'+o.rows.map(function(r){return '<div style="padding:7px 5px;border:1px solid #303b47;border-radius:9px;text-align:center"><div style="font-size:10px;color:#8996a3">'+r[0]+'%</div><div style="font-size:12px;font-weight:900;margin-top:2px">'+won(r[1])+'</div></div>'}).join('')+'</div></div>'}
function mount(){if(document.getElementById('gnCryptoDca'))return;var assets=document.getElementById('assets');var sec=assets&&assets.closest?assets.closest('.section'):null;var box=document.createElement('div');box.id='gnCryptoDca';box.className='section';box.innerHTML='<div class="sectionTitle"><b>BTC · ETH 분할매수 기준</b><span class="muted">현재 대비 -5 / -10 / -15 / -20%</span></div><div style="display:grid;gap:8px">'+card('BTC',levels.BTC)+card('ETH',levels.ETH)+'</div><div style="margin:7px 2px 0;font-size:10px;color:#788591">가격 도달만으로 매수하지 않음 · 유가/미 국채금리/현물수급 중 1개 이상 개선 동반 시 재진입 후보</div>';if(sec&&sec.parentNode)sec.parentNode.insertBefore(box,sec.nextSibling);else(document.querySelector('.wrap')||document.body).appendChild(box)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("gn-crypto-dca-v1"))return html;
  return html.replace("</body>",SCRIPT+"</body>");
}

function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{
    const send=res.send.bind(res);
    res.send=function(body){return send(patchHtml(body));};
    next();
  });
  return app;
}

Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
