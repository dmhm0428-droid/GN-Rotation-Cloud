"use strict";

const HEADINGS=[
  ["LONG_BOND_STABILITY","장기채 안정"],
  ["OIL_STABILITY","유가 안정"],
  ["LIQUIDITY_SUPPLY","유동성 공급"],
  ["AI_CAPEX_SUPPORT","AI 기업 투자속도·정부지원"],
  ["POWER_BITCOIN_NATIONAL_SECURITY","전력·비트코인 채굴·국가안보"],
  ["INVESTMENT_LINK","투자 연결"]
];
const PANEL=`<section id="gnPolicyDetected" style="margin:14px 0;background:#10151b;border:1px solid #293540;border-radius:16px;padding:15px"><div style="font-size:14px;font-weight:900;margin-bottom:9px">큰그림 정책 대시보드</div><div id="gnPolicyDetectedRows"></div></section>`;
const SCRIPT=`<script id="gn-policy-detected-script-v1">(function(){
const heads=[["LONG_BOND_STABILITY","장기채 안정"],["OIL_STABILITY","유가 안정"],["LIQUIDITY_SUPPLY","유동성 공급"],["AI_CAPEX_SUPPORT","AI 기업 투자속도·정부지원"],["POWER_BITCOIN_NATIONAL_SECURITY","전력·비트코인 채굴·국가안보"],["INVESTMENT_LINK","투자 연결"]];
function esc(v){return String(v==null?'':v).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]})}
function render(payload){var axes=new Set(Array.isArray(payload&&payload.axes)?payload.axes:[]),providers=Array.isArray(payload&&payload.providers)?payload.providers:[];var details=providers.map(function(p){return p.summary}).filter(Boolean);var rows=heads.map(function(h){var body='';if(axes.has(h[0]))body='<div style="margin:7px 0 2px;color:#c8d1da;font-size:13px;line-height:1.55">'+details.map(esc).join('<br>')+'</div>';return '<div style="padding:10px 0;border-top:1px solid #202a33"><b>'+h[1]+'</b>'+body+'</div>'}).join('');var box=document.getElementById('gnPolicyDetectedRows');if(box)box.innerHTML=rows}
async function load(){try{var r=await fetch('/api/alerts?t='+Date.now(),{cache:'no-store'});if(r.status===401){location.href='/login';return}if(!r.ok)return;var a=await r.json(),row=(a||[]).find(function(x){return x.level==='큰그림 정책'}),payload=null;try{payload=row?JSON.parse(row.message):null}catch(e){}render(payload)}catch(e){render(null)}}
load();setInterval(load,60000);
})();</script>`;
function patch(html){if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes('gnPolicyDetected'))return html;const hero=html.indexOf('<div class="hero">');if(hero<0)return html;return html.slice(0,hero)+PANEL+html.slice(hero).replace('</body>',SCRIPT+'</body>');}
const http=require("node:http");const write=http.ServerResponse.prototype.write,end=http.ServerResponse.prototype.end;
function capture(res){if(res.__gnPolicyCapture)return;res.__gnPolicyCapture=true;res.__gnPolicyChunks=[];res.write=function(c,e,cb){if(c)this.__gnPolicyChunks.push(Buffer.isBuffer(c)?c:Buffer.from(c,e));if(cb)cb();return true};res.end=function(c,e,cb){if(c)this.__gnPolicyChunks.push(Buffer.isBuffer(c)?c:Buffer.from(c,e));let body=Buffer.concat(this.__gnPolicyChunks);const type=String(this.getHeader('content-type')||'');if(type.includes('text/html'))body=Buffer.from(patch(body.toString('utf8')));this.setHeader('content-length',body.length);write.call(this,body);return end.call(this,null,null,cb)};}
http.Server.prototype.emit=new Proxy(http.Server.prototype.emit,{apply(target,self,args){if(args[0]==='request')capture(args[2]);return Reflect.apply(target,self,args)}});
module.exports={HEADINGS,patch};
