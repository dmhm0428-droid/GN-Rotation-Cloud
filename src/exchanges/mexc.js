"use strict";
const crypto=require("crypto");
const {requestJson,normalizeBalance}=require("./common");
const BASE="https://api.mexc.com";
function auth(env=process.env){if(!env.MEXC_API_KEY||!env.MEXC_API_SECRET)return null;return {key:env.MEXC_API_KEY,secret:env.MEXC_API_SECRET};}
async function balances({env=process.env,fetchImpl=fetch}={}){const a=auth(env);if(!a)return {enabled:false,exchange:"mexc",balances:[]};const qs=`timestamp=${Date.now()}`;const signature=crypto.createHmac("sha256",a.secret).update(qs).digest("hex");const data=await requestJson(`${BASE}/api/v3/account?${qs}&signature=${signature}`,{headers:{"X-MEXC-APIKEY":a.key},fetchImpl});const rows=(data?.balances||[]).filter(r=>Number(r.free)||Number(r.locked));return {enabled:true,exchange:"mexc",balances:rows.map(r=>normalizeBalance("mexc",{asset:r.asset,free:r.free,locked:r.locked,avgPrice:null}))};}
async function prices(assets,{fetchImpl=fetch}={}){const rows=await requestJson(`${BASE}/api/v3/ticker/price`,{fetchImpl});const wanted=new Set((assets||[]).map(a=>String(a).toUpperCase()));const out={USDT:1};for(const r of rows||[]){const s=String(r.symbol||"");if(!s.endsWith("USDT"))continue;const asset=s.slice(0,-4);if(wanted.has(asset))out[asset]=Number(r.price)||0;}return out;}
module.exports={balances,prices};
