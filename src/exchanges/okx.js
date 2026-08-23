"use strict";
const crypto=require("crypto");
const {requestJson,normalizeBalance}=require("./common");
const BASE="https://www.okx.com";
function auth(env=process.env){if(!env.OKX_API_KEY||!env.OKX_API_SECRET||!env.OKX_PASSPHRASE)return null;return {key:env.OKX_API_KEY,secret:env.OKX_API_SECRET,passphrase:env.OKX_PASSPHRASE};}
function sign(secret,timestamp,method,path,body=""){return crypto.createHmac("sha256",secret).update(timestamp+method+path+body).digest("base64");}
async function balances({env=process.env,fetchImpl=fetch}={}){const a=auth(env);if(!a)return {enabled:false,exchange:"okx",balances:[]};const path="/api/v5/account/balance";const ts=new Date().toISOString();const headers={"OK-ACCESS-KEY":a.key,"OK-ACCESS-SIGN":sign(a.secret,ts,"GET",path),"OK-ACCESS-TIMESTAMP":ts,"OK-ACCESS-PASSPHRASE":a.passphrase};const data=await requestJson(`${BASE}${path}`,{headers,fetchImpl});if(data?.code&&data.code!=="0")throw new Error(data.msg||`OKX ${data.code}`);const details=data?.data?.[0]?.details||[];const rows=details.filter(r=>Number(r.availBal)||Number(r.frozenBal)||Number(r.cashBal));return {enabled:true,exchange:"okx",balances:rows.map(r=>normalizeBalance("okx",{asset:r.ccy,free:r.availBal,locked:r.frozenBal,avgPrice:null}))};}
async function prices(assets,{fetchImpl=fetch}={}){const data=await requestJson(`${BASE}/api/v5/market/tickers?instType=SPOT`,{fetchImpl});if(data?.code&&data.code!=="0")throw new Error(data.msg||`OKX ${data.code}`);const wanted=new Set((assets||[]).map(a=>String(a).toUpperCase()));const out={USDT:1};for(const r of data?.data||[]){const id=String(r.instId||"");if(!id.endsWith("-USDT"))continue;const asset=id.slice(0,-5);if(wanted.has(asset))out[asset]=Number(r.last)||0;}return out;}
module.exports={balances,prices};
