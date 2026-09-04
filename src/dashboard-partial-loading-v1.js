"use strict";

// Safe compatibility layer for GN PIVOT partial loading.
// The authoritative dashboard owns rendering. This layer must never overwrite valid
// leader/TOP3/sector/ETF/portfolio DOM with placeholder text.
const expressPath=require.resolve("express");
const previousExpress=require("express");
const crypto=require("node:crypto");
const {createClient}=require("@supabase/supabase-js");

const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const USER=process.env.DASHBOARD_USER||"gn";
const PASS=process.env.DASHBOARD_PASSWORD||"";
const COOKIE_NAME="gn_auth";
function authToken(){return crypto.createHmac("sha256",PASS).update(USER).digest("hex");}
function getCookie(req,name){const raw=req.headers.cookie||"";for(const part of raw.split(";")){const i=part.indexOf("=");if(i<0)continue;if(part.slice(0,i).trim()===name)return decodeURIComponent(part.slice(i+1).trim());}return "";}
function isAuthed(req){return !!PASS&&getCookie(req,COOKIE_NAME)===authToken();}

async function providerStatus(req,res){
  if(!isAuthed(req))return res.status(401).json({error:"Authentication required"});
  try{
    const {data,error}=await db.from("gn_data_provider_status")
      .select("provider,provider_type,status,last_success_at,last_attempt_at,data_quality,error,details")
      .in("provider",["nansen","coinmetrics_community","coinbase_premium","glassnode","onchain_composite"]);
    if(error)throw error;
    res.set("Cache-Control","no-store");
    res.json({ts:new Date().toISOString(),items:data||[]});
  }catch(e){res.status(500).json({error:String(e?.message||e)});}
}

const SCRIPT=`<style id="gn-partial-loading-style-v1">
.gnProviderWarn{color:#ffd166!important}.gnProviderBad{color:#ff8b8b!important}
</style><script id="gn-partial-loading-v1">(function(){
  var providerData=null;
  function byId(id){return document.getElementById(id)}
  function providerMap(){var out={};((providerData&&providerData.items)||[]).forEach(function(x){out[String(x.provider||'')]=x});return out}
  function applyProviderWarning(){
    if(!providerData)return;
    var p=providerMap(),n=p.nansen||{},c=p.onchain_composite||{};
    var nBad=String(n.status||'').toLowerCase()!=='success';
    var entryBlocked=c&&c.details&&c.details.usable_for_entry===false;
    var credit=/insufficient credits|credit|quota|payment required/i.test(String(n.error||''));
    var pill=byId('cryptoState');
    if(pill&&(nBad||entryBlocked)){
      var base=(pill.textContent||'').replace(/ · 온체인 제한.*$/,'');
      pill.textContent=base+' · 온체인 제한'+(credit?'(Nansen 크레딧 0)':'');
      pill.classList.add('gnProviderWarn');
    }
  }
  function loadProviders(){
    return fetch('/api/provider-status?t='+Date.now(),{cache:'no-store'})
      .then(function(r){if(r.status===401){location.href='/login';throw Error('LOGIN')}if(!r.ok)throw Error('HTTP '+r.status);return r.json()})
      .then(function(d){providerData=d;applyProviderWarning();return d})
      .catch(function(){return null});
  }
  function loadPartial(){
    var jobs=[];
    // Authoritative renderer is the only owner of dashboard content.
    if(typeof window.loadGN==='function')jobs.push(Promise.resolve(window.loadGN()));
    else if(typeof window.refreshGN==='function')jobs.push(Promise.resolve(window.refreshGN()));
    jobs.push(loadProviders());
    return Promise.allSettled(jobs);
  }
  window.loadAll=loadPartial;
  window.gnPartialLoad=loadPartial;
  setTimeout(loadPartial,700);
  setInterval(loadProviders,60000);
  setInterval(applyProviderWarning,15000);
})();</script>`;

function isDashboardHtml(html){return typeof html==="string"&&html.includes('id="leaders"')&&html.includes('id="top3"')&&html.includes('id="retirementEtf"')&&html.includes('id="portfolio"')}
function patchHtml(html){if(!isDashboardHtml(html)||html.includes("gn-partial-loading-v1"))return html;return html.replace("</body>",SCRIPT+"</body>")}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.get("/api/provider-status",providerStatus);
  app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
