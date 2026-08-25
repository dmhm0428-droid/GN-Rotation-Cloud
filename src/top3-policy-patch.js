"use strict";

// TOP3 freshness + signal-anchor + live headroom policy layer.
// - TOP3 is "up to 3", never padded with weak names.
// - A 검증중 candidate may stay for only one 15m re-evaluation cycle.
// - First actionable signal price/time (진입/선발대) is anchored and preserved.
// - If the nearest live multi-timeframe resistance is too close, do not allow
//   an ENTRY label just because momentum/OBV is strong.
// - <0.8% first-resistance room: remove from TOP3 until breakout/retest resets room.
// - 0.8~2.0% first-resistance room: keep only as 검증중, never actionable ENTRY.

const expressPath=require.resolve("express");
const originalExpress=require("express");

let previousRunTs=null;
const waitState=new Map();
const signalState=new Map();

function normalizeRunTs(items){
  const values=(items||[]).map(x=>x&&x.updated_at).filter(Boolean).sort();
  return values.length?values[values.length-1]:null;
}
function numberOf(...values){
  for(const v of values){const n=Number(v);if(Number.isFinite(n)&&n>0)return n;}
  return null;
}
function finiteOf(...values){
  for(const v of values){const n=Number(v);if(Number.isFinite(n))return n;}
  return null;
}
function isEntryLike(x){
  const action=String(x?.action||"").toUpperCase();
  const scannerStatus=String(x?.scannerStatus||"").toUpperCase();
  return scannerStatus==="ENTRY"||action==="진입"||action==="선발대"||action.includes("ENTRY")||action.includes("사라");
}
function applyLiveHeadroomGuard(payload){
  if(!Array.isArray(payload))return payload;
  const guarded=[];
  for(const raw of payload){
    const sr=raw?.timeframeContext?.supportResistance||{};
    const distance=finiteOf(sr.resistanceDistance,raw?.todayHeadroom);
    if(distance!=null&&distance>=0&&distance<.008)continue;
    if(distance!=null&&distance>=.008&&distance<.020){
      guarded.push({...raw,
        action:"검증중",
        headroomGuard:"NARROW",
        headroomPct:+(distance*100).toFixed(2),
        headroomReason:`첫 저항까지 ${(distance*100).toFixed(1)}% · 돌파/눌림 확인`});
      continue;
    }
    guarded.push({...raw,
      headroomGuard:distance==null?"UNKNOWN":"OPEN",
      headroomPct:distance==null?null:+(distance*100).toFixed(2)});
  }
  return guarded;
}

function applyTop3Freshness(input){
  const payload=applyLiveHeadroomGuard(input);
  if(!Array.isArray(payload))return payload;
  const runTs=normalizeRunTs(payload);
  if(!runTs)return payload;
  const isNewRun=runTs!==previousRunTs;

  if(isNewRun){
    const present=new Set(payload.map(x=>String(x&&x.market||"")));
    for(const key of waitState.keys())if(!present.has(key))waitState.delete(key);
    for(const key of signalState.keys())if(!present.has(key))signalState.delete(key);

    for(const x of payload){
      const market=String(x&&x.market||"");
      if(!market)continue;
      const waitLike=String(x.action||"")==="검증중";
      if(!waitLike)waitState.delete(market);
      else {
        const prior=waitState.get(market);
        const consecutive=prior&&prior.runTs===previousRunTs?(prior.cycles+1):1;
        waitState.set(market,{cycles:consecutive,runTs});
      }

      // 진입/선발대 모두 사용자가 분할가격을 계산할 수 있도록 첫 가격을 고정한다.
      // 단, 바로 위 저항 때문에 NARROW로 강제된 후보는 진입 기준가를 만들지 않는다.
      if(isEntryLike(x)&&x.headroomGuard!=="NARROW"&&!signalState.has(market)){
        const entryPrice=numberOf(x.krw_price,x.krwPrice,x.price,x.currentPrice);
        signalState.set(market,{signalAt:x.updated_at||runTs,entryPrice,runTs,signalAction:x.action||"진입"});
      }
    }
  }

  const out=[];
  for(const x of payload){
    const market=String(x&&x.market||"");
    const waitLike=String(x.action||"")==="검증중";
    const state=market?waitState.get(market):null;
    const cycles=waitLike?(state?.cycles||1):0;
    if(waitLike&&cycles>=2)continue;

    const sig=market?signalState.get(market):null;
    const currentPrice=numberOf(x.krw_price,x.krwPrice,x.price,x.currentPrice);
    const entryPrice=sig?.entryPrice??null;
    const moveFromEntryPct=entryPrice&&currentPrice?((currentPrice/entryPrice)-1)*100:null;
    const ageMs=sig?.signalAt?Date.now()-new Date(sig.signalAt).getTime():null;
    const signalAgeMin=Number.isFinite(ageMs)?Math.max(0,ageMs/60000):null;

    out.push({...x,waitCycle:cycles,waitMaxCycles:waitLike?2:null,
      signalAt:sig?.signalAt??null,entryPrice,currentPrice,signalAction:sig?.signalAction??null,
      moveFromEntryPct:Number.isFinite(moveFromEntryPct)?+moveFromEntryPct.toFixed(2):null,
      signalAgeMin:Number.isFinite(signalAgeMin)?+signalAgeMin.toFixed(1):null});
  }

  if(isNewRun)previousRunTs=runTs;
  return out.slice(0,3).map((x,i)=>({...x,rank:i+1}));
}

const SCRIPT=`<script>(function(){
  function fmtWon(v){var n=Number(v);if(!Number.isFinite(n))return null;return n.toLocaleString('ko-KR')+'원';}
  function fmtTime(v){if(!v)return null;var d=new Date(v);if(isNaN(d))return null;return d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false});}
  if(typeof window.top3Cards==='function'&&!window.__gnSignalPricePatched){
    window.__gnSignalPricePatched=true;
    window.top3Cards=function(rows){
      var top=(rows||[]).slice(0,3);
      if(!top.length)return '<div class="empty">지금은 신규 진입 후보 없음</div>';
      return top.map(function(r,i){
        var actionRaw=r.action||r.status;
        var a=simpleAction(actionRaw,r.score);
        var meta=[];
        if(r.entryPrice!=null){
          var t=fmtTime(r.signalAt),ep=fmtWon(r.entryPrice),label=r.signalAction==='선발대'?'선발대가':'진입가';
          meta.push(label+' '+(t?t+' · ':'')+ep);
          if(r.currentPrice!=null&&Number(r.currentPrice)!==Number(r.entryPrice))meta.push('현재 '+fmtWon(r.currentPrice));
          if(r.moveFromEntryPct!=null)meta.push('신호후 '+(Number(r.moveFromEntryPct)>=0?'+':'')+Number(r.moveFromEntryPct).toFixed(1)+'%');
        }else meta.push(r.action||r.status||'');
        if(r.headroomPct!=null)meta.push('첫저항 '+Number(r.headroomPct).toFixed(1)+'%');
        if(r.headroomGuard==='NARROW')meta.push('돌파/눌림 확인');
        if(r.signalAgeMin!=null)meta.push(Math.round(Number(r.signalAgeMin))+'분 경과');
        return '<div class="pick"><div class="rank">'+(i+1)+'</div><div><div class="pickName">'+String(r.market||'').replace('KRW-','')+'</div><div class="pickMeta">'+meta.join(' · ')+'</div></div><div class="pickAction '+a.cls+'">'+a.text+'</div></div>';
      }).join('');
    };
  }
  function patchTop3Labels(){
    document.querySelectorAll('h2').forEach(function(h){if((h.textContent||'').trim()==='지금 볼 TOP3')h.textContent='지금 볼 후보 · 최대 3개';});
    var box=document.querySelector('.top3');if(!box)return;
    box.querySelectorAll('.pick').forEach(function(p){var action=p.querySelector('.pickAction');var meta=p.querySelector('.pickMeta');if(action&&(action.textContent||'').trim()==='대기'&&meta&&!meta.textContent.includes('15분 재평가'))meta.textContent += ' · 15분 재평가';});
  }
  patchTop3Labels();
  new MutationObserver(patchTop3Labels).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("GN PIVOT"))return html;
  if(!html.includes("__gnSignalPricePatched"))html=html.replace("</body>",SCRIPT+"</body>");
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
