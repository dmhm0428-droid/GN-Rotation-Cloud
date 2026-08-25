"use strict";

// TOP3 freshness policy layer.
// - TOP3 is "up to 3", never padded with weak names.
// - A 검증중(대기) candidate may stay for only one 15m re-evaluation cycle.
// - If it is still 검증중 on the next distinct scanner run, it expires from TOP3.
// - 진입/선발대 reset the wait counter immediately.

const expressPath=require.resolve("express");
const originalExpress=require("express");

let previousRunTs=null;
const waitState=new Map();

function normalizeRunTs(items){
  const values=(items||[]).map(x=>x&&x.updated_at).filter(Boolean).sort();
  return values.length?values[values.length-1]:null;
}

function applyTop3Freshness(payload){
  if(!Array.isArray(payload))return payload;
  const runTs=normalizeRunTs(payload);
  if(!runTs)return payload;
  const isNewRun=runTs!==previousRunTs;

  if(isNewRun){
    const present=new Set(payload.map(x=>String(x&&x.market||"")));
    for(const key of waitState.keys())if(!present.has(key))waitState.delete(key);

    for(const x of payload){
      const market=String(x&&x.market||"");
      if(!market)continue;
      const waitLike=String(x.action||"")==="검증중";
      if(!waitLike){waitState.delete(market);continue;}
      const prior=waitState.get(market);
      const consecutive=prior&&prior.runTs===previousRunTs?(prior.cycles+1):1;
      waitState.set(market,{cycles:consecutive,runTs});
    }
  }

  const out=[];
  for(const x of payload){
    const market=String(x&&x.market||"");
    const waitLike=String(x.action||"")==="검증중";
    const state=market?waitState.get(market):null;
    const cycles=waitLike?(state?.cycles||1):0;
    if(waitLike&&cycles>=2)continue;
    out.push({...x,waitCycle:cycles,waitMaxCycles:waitLike?2:null});
  }

  if(isNewRun)previousRunTs=runTs;
  return out.slice(0,3).map((x,i)=>({...x,rank:i+1}));
}

const SCRIPT=`<script>(function(){
  function patchTop3Labels(){
    document.querySelectorAll('h2').forEach(function(h){
      if((h.textContent||'').trim()==='지금 볼 TOP3')h.textContent='지금 볼 후보 · 최대 3개';
    });
    var box=document.querySelector('.top3');
    if(!box)return;
    box.querySelectorAll('.pick').forEach(function(p){
      var action=p.querySelector('.pickAction');
      var meta=p.querySelector('.pickMeta');
      if(action&&(action.textContent||'').trim()==='대기'&&meta&&!meta.textContent.includes('15분 재평가')){
        meta.textContent += ' · 15분 재평가';
      }
    });
  }
  patchTop3Labels();
  new MutationObserver(patchTop3Labels).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("GN PIVOT"))return html;
  if(!html.includes("patchTop3Labels"))html=html.replace("</body>",SCRIPT+"</body>");
  return html;
}

function wrappedExpress(...args){
  const app=originalExpress(...args);
  app.use((req,res,next)=>{
    if(req.path==="/api/pre-pump/latest"){
      const json=res.json.bind(res);
      res.json=function(body){return json(applyTop3Freshness(body));};
    }
    const send=res.send.bind(res);
    res.send=function(body){return send(patchHtml(body));};
    next();
  });
  return app;
}

Object.assign(wrappedExpress,originalExpress);
require.cache[expressPath].exports=wrappedExpress;
