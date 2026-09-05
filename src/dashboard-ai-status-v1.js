"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");

const SCRIPT=`<script id="gn-ai-status-v1">(function(){
function e(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
async function loadAi(){
  try{
    var r=await fetch('/api/ai/latest?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);var a=await r.json();
    var box=e('aiState'),decision=e('decision'),reason=e('decisionReason');
    if(!box)return;
    if(!a.eligible){
      var age=Number.isFinite(Number(a.ageMinutes))?Math.round(Number(a.ageMinutes))+'분 전':'최신 검증 없음';
      box.innerHTML='<div><b class="warn">5AI 대기</b> · fresh '+(a.fresh?'YES':'NO')+' · 성공 '+Number(a.successCount||0)+'/5 · '+esc(age)+'</div>';
      if(decision&&reason){decision.textContent='관찰 유지';decision.className='heroAction warn';reason.textContent='TOP3 탐지는 유지 · 최신 5AI 검증 없음으로 ENTRY 승인 보류';}
    }else{
      box.innerHTML='<div><b>'+esc(a.sentiment||'neutral').toUpperCase()+'</b> · providers '+Number(a.successCount||0)+'/5 · confidence '+Math.round(Number(a.confidence||0)*100)+'% · fresh</div>';
    }
  }catch(err){var box=e('aiState');if(box)box.innerHTML='<div><b class="warn">5AI 상태 재조회 중</b></div>';}
}
setTimeout(loadAi,700);setInterval(loadAi,15000);window.gnAiStatus=loadAi;
})();</script>`;
function patchHtml(html){if(typeof html!=="string"||!html.includes("<title>GN PIVOT</title>")||html.includes("gn-ai-status-v1"))return html;return html.replace("</body>",SCRIPT+"</body>");}
function wrappedExpress(...args){const app=previousExpress(...args);app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});return app;}
Object.assign(wrappedExpress,previousExpress);require.cache[expressPath].exports=wrappedExpress;
