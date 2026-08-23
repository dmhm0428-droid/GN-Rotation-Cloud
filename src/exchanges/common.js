"use strict";
const crypto=require("crypto");

function b64url(input){return Buffer.from(input).toString("base64url");}
function jwtHS256(payload,secret){const header=b64url(JSON.stringify({alg:"HS256",typ:"JWT"}));const body=b64url(JSON.stringify(payload));const sig=crypto.createHmac("sha256",secret).update(`${header}.${body}`).digest("base64url");return `${header}.${body}.${sig}`;}
function errorDetail(data){
  if(!data)return "";
  const parts=[];
  const push=v=>{const s=String(v??"").trim();if(s&&!parts.includes(s))parts.push(s);};
  if(typeof data==="string")push(data);
  else if(typeof data==="object"){
    push(data.code);
    push(data.error_code);
    push(data.msg);
    push(data.message);
    if(data.error&&typeof data.error==="object"){
      push(data.error.name);
      push(data.error.code);
      push(data.error.message);
    }else push(data.error);
    if(!parts.length&&data.raw)push(data.raw);
  }
  return parts.join(" · ").slice(0,500);
}
async function requestJson(url,{method="GET",headers={},body,fetchImpl=fetch}={}){
  const r=await fetchImpl(url,{method,headers,body});
  const text=await r.text();
  let data;
  try{data=text?JSON.parse(text):null;}catch{data={raw:text};}
  if(!r.ok){
    const detail=errorDetail(data);
    const e=new Error(`HTTP ${r.status}${detail?` · ${detail}`:""}`);
    e.status=r.status;
    e.data=data;
    throw e;
  }
  return data;
}
const num=v=>Number.isFinite(Number(v))?Number(v):0;
function normalizeBalance(exchange,row){return {exchange,asset:String(row.asset||"").toUpperCase(),free:num(row.free),locked:num(row.locked),total:num(row.free)+num(row.locked),avgPrice:row.avgPrice==null?null:num(row.avgPrice)};}
module.exports={jwtHS256,requestJson,num,normalizeBalance};