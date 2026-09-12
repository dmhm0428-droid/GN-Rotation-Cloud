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
  const rows=[...latest.values()].map(raw=>decorate({...raw,
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
  })).filter(r=>r.discarded===true).sort((a,b)=>new Date(b.ts)-new Date(a.ts)).slice(0,8);
  cache={at:Date.now(),rows};
  return rows;
}

async function attachLifecycle(body){
  if(!body||typeof body!=="object"||Array.isArray(body))return body;
  try{return {...body,cryptoDiscarded:await loadDiscarded()};}
  catch(error){return {...body,cryptoTop3RevalidationError:String(error?.message||error)};}
}

function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{
    if(req.path==="/api/live-summary"){
      const json=res.json.bind(res);
      res.json=function(body){Promise.resolve(attachLifecycle(body)).then(x=>json(x)).catch(()=>json(body));return res;};
    }
    next();
  });
  return app;
}
Object.assign(wrappedExpress,previousExpress);
wrappedExpress.application=previousExpress.application;
require.cache[expressPath].exports=wrappedExpress;
