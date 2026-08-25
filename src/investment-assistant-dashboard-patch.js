"use strict";

const expressPath=require.resolve("express");
const originalExpress=require("express");

const SCRIPT=`<script>(function(){
  function cls(stage){stage=String(stage||'');if(stage==='ENTRY_EDGE')return 'good';if(stage==='SCOUT')return 'warn';return 'neutral';}
  function label(stage){if(stage==='ENTRY_EDGE')return '매수 시작 Edge';if(stage==='SCOUT')return '선발대 가능';if(stage==='WATCH')return '관찰';return '대기';}
  function nameOf(coin){return String(coin||'').replace('ASSET:','').replace('AI_POWER','AI/전력').replace('DEFENSE','방산').replace('GOLD','금');}
  async function loadRecoveryLeader(){
    try{
      var r=await fetch('/api/alerts',{headers:{Accept:'application/json'}});if(!r.ok)return;
      var rows=await r.json();
      var x=(rows||[]).find(function(a){return a.level==='복귀1등'&&String(a.coin||'').indexOf('ASSET:')===0;});
      var host=document.getElementById('gn-recovery-layer');if(!host)return;
      if(!x){host.innerHTML='<div class="eyebrow">투자비서 · 돈의 발자국</div><div class="subaction">아직 복귀 1등 신호 없음 · 현금/관찰</div>';return;}
      host.innerHTML='<div class="eyebrow">투자비서 · 돈의 발자국 · 복귀 1등</div><div style="display:flex;justify-content:space-between;gap:12px;align-items:end"><div><div style="font-size:27px;font-weight:950">'+nameOf(x.coin)+'</div><div class="subaction">'+String(x.message||'')+'</div></div><div class="'+cls(x.stage)+'" style="font-size:18px;font-weight:950;white-space:nowrap">'+label(x.stage)+'</div></div>';
    }catch(e){}
  }
  function mount(){
    if(document.getElementById('gn-recovery-layer'))return;
    var wrap=document.querySelector('.wrap');if(!wrap)return;
    var hero=wrap.querySelector('.hero');
    var box=document.createElement('div');box.id='gn-recovery-layer';box.className='hero';
    box.innerHTML='<div class="eyebrow">투자비서 · 돈의 발자국</div><div class="subaction">복귀 1등 자산군 계산 중…</div>';
    if(hero&&hero.parentNode)hero.parentNode.insertBefore(box,hero.nextSibling);else wrap.insertBefore(box,wrap.firstChild);
    loadRecoveryLeader();setInterval(loadRecoveryLeader,60000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("gn-recovery-layer"))return html;
  return html.replace("</body>",SCRIPT+"</body>");
}

function wrappedExpress(...args){
  const app=originalExpress(...args);
  app.use((req,res,next)=>{
    const send=res.send.bind(res);
    res.send=function(body){return send(patchHtml(body));};
    next();
  });
  return app;
}

Object.assign(wrappedExpress,originalExpress);
require.cache[expressPath].exports=wrappedExpress;
