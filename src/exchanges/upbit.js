"use strict";
const crypto=require("crypto");
const {jwtHS512,cleanSecret,requestJson,normalizeBalance}=require("./common");
const BASE="https://api.upbit.com";
function auth(env=process.env){const access=cleanSecret(env.UPBIT_ACCESS_KEY),secret=cleanSecret(env.UPBIT_SECRET_KEY);if(!access||!secret)return null;return {access,secret};}
async function balances({env=process.env,fetchImpl=fetch}={}){const a=auth(env);if(!a)return {enabled:false,exchange:"upbit",balances:[]};const token=jwtHS512({access_key:a.access,nonce:crypto.randomUUID()},a.secret);const rows=await requestJson(`${BASE}/v1/accounts`,{headers:{Authorization:`Bearer ${token}`},fetchImpl});return {enabled:true,exchange:"upbit",balances:(rows||[]).map(r=>normalizeBalance("upbit",{asset:r.currency,free:r.balance,locked:r.locked,avgPrice:r.avg_buy_price}))};}
async function prices(assets,{fetchImpl=fetch}={}){const markets=[...new Set((assets||[]).filter(a=>a&&a!=="KRW").map(a=>`KRW-${a}`))];if(!markets.length)return {KRW:1};const rows=await requestJson(`${BASE}/v1/ticker?markets=${encodeURIComponent(markets.join(","))}`,{fetchImpl});const out={KRW:1};for(const r of rows||[])out[String(r.market).replace("KRW-","")]=Number(r.trade_price)||0;return out;}
module.exports={balances,prices};