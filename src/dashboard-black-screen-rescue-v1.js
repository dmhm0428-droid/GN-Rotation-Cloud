"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");

const RESCUE=`<style id="gn-black-screen-rescue-v1">
html,body{visibility:visible!important;opacity:1!important;min-height:100%!important}
body{display:block!important;overflow-x:hidden!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch!important;touch-action:pan-y!important}
.wrap,#gnRoot,#app,main{visibility:visible!important;opacity:1!important;pointer-events:auto!important}.tabs,.tab,button,a,details,summary{pointer-events:auto!important;touch-action:manipulation!important}.tabs{overflow-x:auto!important;-webkit-overflow-scrolling:touch!important}
</style>
<script id="gn-black-screen-rescue-runtime-v1">(function(){
function rescue(){
  document.documentElement.style.visibility='visible';
  document.documentElement.style.opacity='1';
  if(document.body){document.body.style.visibility='visible';document.body.style.opacity='1';document.body.style.display='block';document.body.style.overflowY='auto';document.body.style.overflowX='hidden';document.body.style.touchAction='pan-y';document.body.style.position='static';}
  var visible=document.querySelector('.wrap,#gnRoot,#app,main');
  if(visible){visible.style.visibility='visible';visible.style.opacity='1';if(getComputedStyle(visible).display==='none')visible.style.display='block';}
  var text=(document.body&&document.body.innerText||'').trim();
  if(text.length<8&&document.body){
    document.body.innerHTML='<div style="max-width:820px;margin:auto;padding:18px;color:#eef2f6;font-family:system-ui;background:#080a0d;min-height:100vh"><h2 style="margin:0 0 8px">GN PIVOT</h2><div style="color:#ffd166">화면 복구 모드</div><p style="color:#aab5bf">대시보드 렌더링 충돌을 감지했습니다. 새로고침하면 자동 재시도합니다.</p><button onclick="location.reload()" style="padding:10px 14px;border-radius:9px;border:1px solid #3a4654;background:#171d24;color:#fff">새로고침</button></div>';
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',rescue);else rescue();
setTimeout(rescue,800);
})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("gn-black-screen-rescue-v1"))return html;
  let out=html;
  if(out.includes("</head>"))out=out.replace("</head>",RESCUE.split("<script")[0]+"</head>");
  if(out.includes("</body>"))out=out.replace("</body>","<script"+RESCUE.split("<script")[1]+"</body>");
  return out;
}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
