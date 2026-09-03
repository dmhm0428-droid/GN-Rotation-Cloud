"use strict";

// Fail-open loader for the current compact SCALP dashboard body.
// Reuses the dashboard's existing marketHero/majorCards/top3Cards renderers;
// it only makes the three API requests independent so one failure cannot blank TOP3.
const expressPath=require.resolve("express");
const previousExpress=require("express");

const SCRIPT=`<script id="gn-scalp-failopen-v1">(function(){
  function isScalp(){return !!(document.getElementById('hero')&&document.getElementById('majors')&&document.getElementById('top3')&&document.getElementById('updated'));}
  if(!isScalp())return;
  var generation=0;
  async function getJson(url,ms){
    var c=new AbortController(),t=setTimeout(function(){c.abort()},ms||5000);
    try{
      var r=await fetch(url+(url.indexOf('?')>=0?'&':'?')+'t='+Date.now(),{cache:'no-store',signal:c.signal});
      if(r.status===401){location.href='/login';throw new Error('로그인이 필요합니다');}
      if(!r.ok)throw new Error('HTTP '+r.status);
      return await r.json();
    }finally{clearTimeout(t);}
  }
  async function loadScalpFailOpen(){
    var token=++generation,updated=document.getElementById('updated');
    if(updated)updated.textContent='부분 갱신 중…';
    var results=await Promise.allSettled([
      getJson('/api/market/live',5000),
      getJson('/api/latest',4500),
      getJson('/api/pre-pump/latest',4500)
    ]);
    if(token!==generation)return;
    var ok=0,failed=[];
    if(results[0].status==='fulfilled'){
      ok++;try{document.getElementById('hero').innerHTML=marketHero(results[0].value);}catch(e){failed.push('시장표시');}
    }else{
      failed.push('시장');document.getElementById('hero').innerHTML='<div class="action bad">기다려</div><div class="subaction">시장 데이터 지연 · 신규 진입 판정 보류</div>';
    }
    if(results[1].status==='fulfilled'){
      ok++;try{document.getElementById('majors').innerHTML=majorCards(results[1].value);}catch(e){failed.push('BTC·ETH·SOL 표시');}
    }else{
      failed.push('BTC·ETH·SOL');document.getElementById('majors').innerHTML='<div class="empty">시장받침 데이터 지연 · 자동 재조회</div>';
    }
    if(results[2].status==='fulfilled'){
      ok++;try{document.getElementById('top3').innerHTML=top3Cards(results[2].value);}catch(e){failed.push('TOP3 표시');}
    }else{
      failed.push('TOP3');document.getElementById('top3').innerHTML='<div class="empty">TOP3 데이터 지연 · 자동 재조회 · ENTRY 판정 보류</div>';
    }
    if(updated)updated.textContent=(failed.length?'부분 지연 '+failed.join('·')+' · 정상 '+ok+'/3':'정상 · 3/3')+' · '+new Date().toLocaleTimeString()+' · 60초 자동';
  }
  window.loadAll=loadScalpFailOpen;
  var old=document.querySelector('.topActions button');
  if(old){var b=old.cloneNode(true);b.removeAttribute('onclick');old.parentNode.replaceChild(b,old);b.addEventListener('click',function(e){e.preventDefault();loadScalpFailOpen();});}
  loadScalpFailOpen();
  setInterval(loadScalpFailOpen,60000);
})();</script>`;

function isScalpHtml(html){
  return typeof html==="string"&&html.includes('id="hero"')&&html.includes('id="majors"')&&html.includes('id="top3"')&&html.includes('id="updated"');
}
function patchHtml(html){
  if(!isScalpHtml(html)||html.includes('gn-scalp-failopen-v1'))return html;
  // Disable only the compact page's old all-or-nothing auto start. Keep its renderer functions.
  html=html.replace(/loadAll\(\);setInterval\(loadAll,60000\);\s*<\/script>/,'</script>');
  return html.replace('</body>',SCRIPT+'</body>');
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
