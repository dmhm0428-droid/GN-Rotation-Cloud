"use strict";
const crypto=require("crypto");
const {cleanSecret,requestJson}=require("./exchanges/common");
const BASE="https://openapi.okx.com";

function auth(env=process.env){
  const key=cleanSecret(env.OKX_API_KEY),secret=cleanSecret(env.OKX_API_SECRET),passphrase=cleanSecret(env.OKX_PASSPHRASE);
  if(!key||!secret||!passphrase)return null;
  return {key,secret,passphrase};
}
function mode(env=process.env){
  const m=String(env.OKX_AUTO_TRADE_MODE||"paper").toLowerCase();
  return ["paper","demo","live"].includes(m)?m:"paper";
}
function sign(secret,timestamp,method,path,body=""){
  return crypto.createHmac("sha256",secret).update(timestamp+method+path+body).digest("base64");
}
async function privateRequest(path,{method="GET",body=null,env=process.env,fetchImpl=fetch}={}){
  const a=auth(env);if(!a)throw new Error("OKX API credentials missing");
  const ts=new Date().toISOString();
  const payload=body==null?"":JSON.stringify(body);
  const headers={
    "OK-ACCESS-KEY":a.key,
    "OK-ACCESS-SIGN":sign(a.secret,ts,method,path,payload),
    "OK-ACCESS-TIMESTAMP":ts,
    "OK-ACCESS-PASSPHRASE":a.passphrase,
    "Content-Type":"application/json"
  };
  if(mode(env)==="demo")headers["x-simulated-trading"]="1";
  const data=await requestJson(`${BASE}${path}`,{method,headers,body:payload||undefined,fetchImpl});
  if(data?.code&&data.code!=="0")throw new Error(data.msg||`OKX ${data.code}`);
  return data;
}
async function getTradingStatus({env=process.env,fetchImpl=fetch}={}){
  const a=auth(env);if(!a)return {connected:false,mode:mode(env),liveUnlocked:false,reason:"API credentials missing"};
  try{
    const data=await privateRequest("/api/v5/account/config",{env,fetchImpl});
    const cfg=data?.data?.[0]||{};
    const perms=String(cfg.perm||"").split(",").filter(Boolean);
    const liveUnlocked=mode(env)==="live"&&String(env.OKX_LIVE_TRADING_CONFIRM||"")==="I_UNDERSTAND";
    return {connected:true,mode:mode(env),perm:perms,ip:cfg.ip||"",accountLevel:cfg.acctLv||null,canTrade:perms.includes("trade"),liveUnlocked};
  }catch(error){return {connected:false,mode:mode(env),liveUnlocked:false,reason:String(error?.message||error)};}
}
async function placeSpotLimit({instId,side,price,size,clientOrderId,env=process.env,fetchImpl=fetch}={}){
  const m=mode(env);
  if(!instId||!['buy','sell'].includes(side)||!(Number(price)>0)||!(Number(size)>0))throw new Error("Invalid order parameters");
  if(m==="paper")return {mode:"paper",submitted:false,order:{instId,side,price:Number(price),size:Number(size),clientOrderId:clientOrderId||null}};
  if(m==="live"&&String(env.OKX_LIVE_TRADING_CONFIRM||"")!=="I_UNDERSTAND")throw new Error("LIVE trading locked");
  const body={instId,tdMode:"cash",side,ordType:"limit",px:String(price),sz:String(size)};
  if(clientOrderId)body.clOrdId=String(clientOrderId).replace(/[^A-Za-z0-9]/g,"").slice(0,32);
  const data=await privateRequest("/api/v5/trade/order",{method:"POST",body,env,fetchImpl});
  return {mode:m,submitted:true,response:data};
}
module.exports={mode,getTradingStatus,placeSpotLimit};
