"use strict";

const expressPath=require.resolve("express");
const previousExpress=require("express");
const {createClient}=require("@supabase/supabase-js");
const {decorate}=require("./leading-top3-policy");
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

const WINDOW_MS=6*60*60*1000;
const CACHE_MS=45*1000;
let cache={at:0,rows:[]};

async function loadDiscarded(){
  if(Date.now()-cache.at<CACHE_MS)return cache.rows;
  const cutoff=new Date(Date.now()-WINDOW_MS).toISOString();
  const {data,error}=await db.from("gn_pre_pump_snapshots").select("*").gte("ts",cutoff).order("ts",{ascending:false}).limit(240);
  if(error)throw error;
  const latest=new Map();
  for(const raw of data||[]){
    const key=String(raw.market||"");
    if(!key||latest.has(key))continue;
    latest.set(key,raw);
  }
  const rows=[...latest.values()].map(raw=>{
    const d=decorate({...raw,
      currentPrice:raw.current_price??raw.price??raw.krw_price??null,
      firstDetectedPrice:raw.first_detected_price??raw.details?.first_detected_price??null,
      firstDetectedAt:raw.first_detected_at??raw.details?.first_detected_at??null,
      repeatCount:raw.repeat_count??raw.details?.repeat_count??0,
      maAlignment:raw.ma_alignment??raw.details?.ma_alignment??null,
      ma20Slope:raw.ma20_slope??raw.details?.ma20_slope??null,
      obv1h:raw.obv_1h??raw.details?.obv_1h??null,
      volumeAccel5m:raw.volume_accel_5m??raw.details?.volume_accel_5m??null,
      riseSinceFirstPct:raw.rise_since_first_pct??raw.details?.rise_since_first_pct??null,
      candidateAgeMin:Math.max(0,(Date.now()-new Date(raw.ts).getTime())/60000)
    });
    return d;
  }).filter(r=>r.discarded===true).sort((a,b)=>new Date(b.ts)-new Date(a.ts)).slice(0,8);
  cache={at:Date.now(),rows};
  return rows;
}

async function attachLifecycle(body){
  if(!body||typeof body!=="object"||Array.isArray(body))return body;
  try{
    const discarded=await loadDiscarded();
    // IMPORTANT: cryptoRadar is the canonical TOP3 payload produced upstream.
    // Revalidation is display-only here; never re-rank, reclassify, or filter TOP3.
    return {...body,
      cryptoDiscarded:discarded,
      cryptoTop3ValidationNote:"TOP3 본문은 canonical 단일 렌더러 원본을 그대로 유지한다. 사후검증·폐기 후보는 별도 패널에만 표시한다."
    };
  }catch(error){
    return {...body,cryptoTop3RevalidationError:String(error?.message||error)};
  }
}

const STYLE=`<style id="gn-top3-revalidation-v3-style">
#gnDiscarded{margin-top:12px;border-top:1px solid #2b3540;padding-top:10px}.gnDiscardTitle{font-size:12px;font-weight:900;color:#ff8585;margin-bottom:7px}.gnDiscardRow{padding:9px 10px;margin:6px 0;background:#171113;border:1px solid #4d292e;border-radius:10px}.gnDiscardHead{display:flex;justify-content:space-between;gap:8px;font-size:13px;font-weight:900}.gnDiscardState{color:#ff8585}.gnDiscardMeta{font-size:10px;color:#a99da0;line-height:1.45;margin-top:4px}.gnConfidence{font-variant-numeric:tabular-nums}.gnGateNote{font-size:10px;color:#7f8d9a;line-height:1.45;margin-top:8px}
</style>`;

const SCRIPT=`<script id="gn-top3-revalidation-v3-ui">(function(){
 var payload=null,oldFetch=window.fetch.bind(window);
 function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
 function nf(v){var n=Number(v);return Number.isFinite(n)?n.toLocaleString('ko-KR'):'--'}
 function render(){var top=document.getElementById('top3');if(!top||!payload)return;var old=document.getElementById('gnDiscarded');if(old)old.remove();var rows=Array.isArray(payload.cryptoDiscarded)?payload.cryptoDiscarded:[];var wrap=document.createElement('div');wrap.id='gnDiscarded';var h='<div class="gnDiscardTitle">사후검증 · 폐기 후보</div>';if(!rows.length)h+='<div class="gnDiscardMeta">현재 폐기 판정 없음 · 발견 종목은 계속 재검증 중</div>';else h+=rows.map(function(r){var rs=Array.isArray(r.discardReasons)?r.discardReasons:[];return '<div class="gnDiscardRow"><div class="gnDiscardHead"><span>'+esc(String(r.market||'').replace('KRW-',''))+'</span><span class="gnDiscardState">폐기</span></div><div class="gnDiscardMeta">검증신뢰 <span class="gnConfidence">'+nf(r.validationConfidence)+'/100</span> · '+esc(rs.join(' · ')||'구조 훼손')+'</div></div>'}).join('');h+='<div class="gnGateNote">TOP3 본문은 canonical 단일 렌더러 결과를 변경하지 않으며, 이 영역은 사후검증 정보만 별도 표시한다.</div>';wrap.innerHTML=h;top.parentNode.insertBefore(wrap,top.nextSibling)}
 window.fetch=async function(){var args=[].slice.call(arguments),r=await oldFetch.apply(window,args);try{var u=String(args[0]&&args[0].url?args[0].url:args[0]||'');if(u.indexOf('/api/live-summary')>=0)r.clone().json().then(function(d){payload=d;setTimeout(render,80);setTimeout(render,300)}).catch(function(){})}catch(e){}return r};
 new MutationObserver(function(){if(payload)setTimeout(render,30)}).observe(document.documentElement,{subtree:true,childList:true});
})();</script>`;

function patchHtml(html){if(typeof html!=="string"||html.includes("gn-top3-revalidation-v3-ui"))return html;return html.replace("</body>",STYLE+SCRIPT+"</body>");}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{
    if(req.path==="/api/live-summary"){
      const json=res.json.bind(res);
      res.json=function(body){Promise.resolve(attachLifecycle(body)).then(x=>json(x)).catch(()=>json(body));return res;};
    }
    const send=res.send.bind(res);
    res.send=function(body){if(typeof body==="string"&&body.includes("GN PIVOT"))body=patchHtml(body);return send(body);};
    next();
  });
  return app;
}
Object.assign(wrappedExpress,previousExpress);
wrappedExpress.application=previousExpress.application;
require.cache[expressPath].exports=wrappedExpress;
