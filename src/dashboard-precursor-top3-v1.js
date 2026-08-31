"use strict";

// Final display layer for precursor-first TOP3.
// Loaded first so its HTML post-processing runs last, after the authoritative body renderer.
const expressPath=require.resolve("express");
const previousExpress=require("express");
const {createClient}=require("@supabase/supabase-js");
const {enrichLiveSummary}=require("./precursor-dashboard");
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

const STYLE=`<style id="gn-precursor-top3-style">
.precursorBadge{display:inline-flex;align-items:center;border:1px solid currentColor;border-radius:999px;padding:2px 7px;font-size:11px;font-weight:850;margin-left:5px}.precursorAction{font-size:15px;font-weight:900;white-space:nowrap}.precursorLine{font-size:12px;color:#9eabb8;margin-top:4px;line-height:1.45}.precursorWhy{font-size:12px;color:#c7d0da;line-height:1.45}.precursorLearn{margin-top:6px;padding-top:6px;border-top:1px solid #27313b;color:#8ea0b2;font-size:11px}.precursorOk{color:#55d98b}.precursorNo{color:#8d99a6}.precursorPending{color:#ffd166}
@media(max-width:560px){.precursorAction{font-size:13px}.precursorLine{font-size:11px}}
</style>`;

const SCRIPT=`<script id="gn-precursor-top3-v1">(function(){
  var originalFetch=window.fetch.bind(window), payload=null, rendering=false;
  function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
  function n(v){var x=Number(v);return Number.isFinite(x)?x:null}
  function nf(v){var x=n(v);return x==null?'--':x.toLocaleString('ko-KR')}
  function pct(v){var x=n(v);return x==null?'대기':(x>=0?'+':'')+x.toFixed(1)+'%'}
  function tm(v){if(!v)return '--';var d=new Date(v);return isNaN(d)?'--':d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false})}
  function check(label,v){return '<span class="'+(v===true?'precursorOk':'precursorNo')+'">'+label+' '+(v===true?'✓':'미확인')+'</span>'}
  function stageClass(r){return r.stageTone==='good'?'good':r.stageTone==='bad'?'bad':r.stageTone==='warn'?'warn':'neutral'}
  function actionClass(r){return r.precursorActionTone==='good'?'good':r.precursorActionTone==='bad'?'bad':r.precursorActionTone==='warn'?'warn':'neutral'}
  function postLine(p){p=p||{};return '사후 '+p.state+' · 15m '+pct(p.ret15m)+' · 30m '+pct(p.ret30m)+' · 1h '+pct(p.ret1h)+' · 3h '+pct(p.ret3h)+(p.mfe3h!=null?' · MFE '+pct(p.mfe3h):'')+(p.outcome?' · '+esc(p.outcome):'')}
  function learnLine(s){if(!s)return '동일 반복군 사후검증: 표본 축적 중';var a='동일 반복군 '+esc(s.bucket)+' · 표본 '+nf(s.episodes);if(Number(s.n3h)>0)a+=' · 3h +5% 도달 '+nf(s.hit3h5Pct)+'% · 평균 MFE '+nf(s.avgMfe3hPct)+'% · 평균 MAE '+nf(s.avgMae3hPct)+'%';else if(Number(s.n1h)>0)a+=' · 1h +3% 도달 '+nf(s.win1h3Pct)+'%';else a+=' · 사후 표본 축적 중';return a}
  function card(r,i){var p=r.persistence||{},e=r.expansion||{},post=r.postValidation||{};var first=r.firstDetectedPrice!=null?nf(r.firstDetectedPrice)+'원':'--';var now=r.currentPrice!=null?nf(r.currentPrice)+'원':'--';var rise=r.riseSinceFirstPct==null?'':(' · 최초후 '+pct(r.riseSinceFirstPct));var observe=r.observationOnly!==false?' · SCOUT는 관찰신호, ENTRY 아님':'';return '<article class="pick" data-gn-precursor-card="1"><div class="pickRank">'+(i+1)+'</div><div class="pickMain"><div class="pickName">'+esc(String(r.market||'').replace('KRW-',''))+' <span class="precursorBadge '+stageClass(r)+'">'+esc(r.stageLabel||'신규 전조')+'</span></div><div class="pickPrice">현재 '+now+' · 최초 '+tm(r.firstDetectedAt)+' '+first+rise+'</div><div class="precursorLine">반복 '+nf(r.repeatCount)+'회 · 30분 TOP3 '+nf(p.top3Count30m)+'회 · 연속 '+nf(p.consecutiveTop3)+'회 · 6시간 TOP6 '+nf(p.top6Count6h)+'회</div><div class="precursorLine">확장 '+(e.score==null?'--':nf(e.score))+' · '+check('해외현물',e.globalSpotOk)+' · '+check('파생',e.derivativesOk)+' · '+check('온체인',e.onchainOk)+' · MA '+(r.maScore==null?'--':nf(r.maScore))+'</div><div class="precursorLine">'+postLine(post)+'</div><div class="precursorLearn">'+learnLine(r.validationStats)+'</div></div><div><div class="precursorAction '+actionClass(r)+'">'+esc(r.precursorAction||'전조감시')+'</div><div class="precursorWhy">'+esc(e.thesis||r.details?.decision_reason||'전조 확장검증 중')+observe+'</div></div></article>'}
  function render(){if(rendering||!payload)return;var box=document.getElementById('top3');if(!box)return;var rows=(payload.cryptoRadar||[]).slice(0,3);rendering=true;try{box.innerHTML=payload.precursorStale?'<div class="empty">전조 데이터 지연 · 신규 진입 금지</div>':rows.length?rows.map(card).join(''):'<div class="empty">현재 유효 전조 TOP3 없음</div>';var pill=document.getElementById('cryptoState');if(pill){var c3=rows.filter(function(x){return x.precursorStage==='CONFIRMED_REPEAT_3'}).length,c2=rows.filter(function(x){return x.precursorStage==='REPEAT_2'}).length,en=rows.filter(function(x){return x.entryAllowed===true&&String(x.status||'').toUpperCase()==='ENTRY'}).length;pill.textContent='반복확정 '+c3+' · 반복2 '+c2+' · 신규 '+Math.max(0,rows.length-c3-c2)+' · ENTRY '+en}var sec=box.closest('section');if(sec){var t=sec.querySelector('.sectionTitle'),s=sec.querySelector('.sub');if(t)t.textContent='크립토 전조 TOP3 · 반복 우선';if(s)s.textContent='전조 → 반복 TOP3 → 해외현물·파생 확장검증 → 사후검증';}}finally{setTimeout(function(){rendering=false},0)}}
  window.fetch=async function(){var args=[].slice.call(arguments),r=await originalFetch.apply(window,args);try{var u=String(args[0]&&args[0].url?args[0].url:args[0]||'');if(u.indexOf('/api/live-summary')>=0)r.clone().json().then(function(d){payload=d;setTimeout(render,0)}).catch(function(){})}catch(e){}return r};
  var obs=new MutationObserver(function(m){if(rendering||!payload)return;for(var i=0;i<m.length;i++){var target=m[i].target;if(target&&((target.id==='top3')||(target.closest&&target.closest('#top3')))){var box=document.getElementById('top3');if(box&&!box.querySelector('[data-gn-precursor-card="1"]'))setTimeout(render,0);break}}});
  function start(){var box=document.getElementById('top3');if(box)obs.observe(box,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("<title>GN PIVOT</title>")||html.includes("gn-precursor-top3-v1"))return html;
  return html.replace("</body>",STYLE+SCRIPT+"</body>");
}

function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{
    if(req.path==="/api/live-summary"){
      const json=res.json.bind(res);
      res.json=function(body){
        Promise.resolve(enrichLiveSummary(db,body)).then(enriched=>json(enriched)).catch(()=>json({...body,cryptoRadar:[],precursorStale:true,precursorError:"ENRICH_FAILED"}));
        return res;
      };
    }
    const send=res.send.bind(res);
    res.send=function(body){return send(patchHtml(body));};
    next();
  });
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
