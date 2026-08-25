"use strict";
const crypto=require("crypto");
const {cleanSecret,requestJson}=require("./exchanges/common");
const BASE="https://www.okx.com";

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
  if(!instId||!["buy","sell"].includes(side)||!(Number(price)>0)||!(Number(size)>0))throw new Error("Invalid order parameters");
  if(m==="paper")return {mode:"paper",submitted:false,order:{instId,side,price:Number(price),size:Number(size),clientOrderId:clientOrderId||null}};
  if(m==="live"&&String(env.OKX_LIVE_TRADING_CONFIRM||"")!=="I_UNDERSTAND")throw new Error("LIVE trading locked");
  const body={instId,tdMode:"cash",side,ordType:"limit",px:String(price),sz:String(size)};
  if(clientOrderId)body.clOrdId=String(clientOrderId).replace(/[^A-Za-z0-9]/g,"").slice(0,32);
  const data=await privateRequest("/api/v5/trade/order",{method:"POST",body,env,fetchImpl});
  return {mode:m,submitted:true,response:data};
}
async function runPaperSelfTest({env=process.env,fetchImpl=fetch}={}){
  const status=await getTradingStatus({env,fetchImpl});
  if(!status.connected)return {ok:false,stage:"auth",status};
  const ticker=await requestJson(`${BASE}/api/v5/market/ticker?instId=BTC-USDT`,{fetchImpl});
  if(ticker?.code&&ticker.code!=="0")throw new Error(ticker.msg||`OKX ${ticker.code}`);
  const last=Number(ticker?.data?.[0]?.last);
  if(!(last>0))throw new Error("BTC-USDT ticker unavailable");
  const notionalUsdt=5;
  const size=+(notionalUsdt/last).toFixed(8);
  const preview=await placeSpotLimit({instId:"BTC-USDT",side:"buy",price:last,size,clientOrderId:`GNTEST${Date.now()}`,env:{...env,OKX_AUTO_TRADE_MODE:"paper"},fetchImpl});
  return {ok:true,stage:"paper",ts:new Date().toISOString(),status,ticker:{instId:"BTC-USDT",last},preview,warning:"PAPER ONLY - no order submitted"};
}

async function getExistingHoldings({env=process.env,fetchImpl=fetch,minUsd=5}={}){
  const data=await privateRequest("/api/v5/account/balance",{env,fetchImpl});
  const details=data?.data?.[0]?.details||[];
  const assets=details.map(r=>({
    asset:String(r.ccy||"").toUpperCase(),
    free:Number(r.availBal)||0,
    frozen:Number(r.frozenBal)||0,
    total:Number(r.cashBal)||0,
    eqUsd:Number(r.eqUsd)||0,
    avgPrice:Number(r.avgPx)||null,
    upl:Number(r.upl)||null,
    uplRatio:Number(r.uplRatio)||null
  })).filter(r=>r.asset&&r.asset!=="USDT"&&r.eqUsd>=minUsd&&r.total>0);

  const tickers=await requestJson(`${BASE}/api/v5/market/tickers?instType=SPOT`,{fetchImpl});
  const byAsset={};
  for(const t of tickers?.data||[]){
    const id=String(t.instId||"");
    if(id.endsWith("-USDT"))byAsset[id.slice(0,-5)]={instId:id,last:Number(t.last)||null};
  }
  return assets.map(r=>({...r,instId:byAsset[r.asset]?.instId||null,last:byAsset[r.asset]?.last||null})).filter(r=>r.instId&&r.last>0);
}

function paperTargetTemplate(bucket){
  if(bucket==="HEAVY_LOSS_RECOVERY")return [{upPct:10,sellPct:20},{upPct:20,sellPct:25},{upPct:35,sellPct:25}];
  if(bucket==="RECOVERY")return [{upPct:7,sellPct:20},{upPct:12,sellPct:25},{upPct:20,sellPct:25}];
  if(bucket==="PROFIT_PROTECT")return [{upPct:5,sellPct:20},{upPct:10,sellPct:25},{upPct:15,sellPct:25}];
  return [];
}
function buildPaperRecoveryTargets({asset,last,qty,bucket}){
  if(String(asset).toUpperCase()==="BTC")return {enabled:false,reason:"BTC 제외 · 별도 관리",targets:[]};
  if(bucket==="DEEP_LOSS_LOCK")return {enabled:false,reason:"초대형 손실 잠금 · 자동매도 금지",targets:[]};
  const p=Number(last),q=Number(qty);
  if(!(p>0)||!(q>0))return {enabled:false,reason:"가격/수량 확인 필요",targets:[]};
  const tpl=paperTargetTemplate(bucket);
  const targets=tpl.map((t,i)=>({
    level:i+1,
    upPct:t.upPct,
    sellPct:t.sellPct,
    price:+(p*(1+t.upPct/100)).toPrecision(8),
    size:+(q*t.sellPct/100).toPrecision(8),
    side:"sell",
    submitted:false,
    mode:"paper"
  }));
  return {enabled:targets.length>0,reason:targets.length?"현재가 기준 임시 PAPER 회수선 · 실제 저항선 확정 전":"회수선 없음",targets};
}

function buildRecoveryPolicy(position){
  const avg=Number(position.avgPrice),last=Number(position.last),value=Number(position.eqUsd)||0;
  const lossPct=avg>0&&last>0?(last/avg-1)*100:null;
  let bucket="NORMAL_RECOVERY";
  let action="회복구간 계산 대기";
  if(lossPct!=null&&lossPct<=-80){bucket="DEEP_LOSS_LOCK";action="자동매도 잠금 · 별도 회수전략";}
  else if(lossPct!=null&&lossPct<=-40){bucket="HEAVY_LOSS_RECOVERY";action="반등 저항 확인 후 분할회수";}
  else if(lossPct!=null&&lossPct<0){bucket="RECOVERY";action="회복구간 분할회수";}
  else if(lossPct!=null){bucket="PROFIT_PROTECT";action="수익보호 분할매도";}
  const paperRecovery=buildPaperRecoveryTargets({asset:position.asset,last,qty:position.total,bucket});
  return {asset:position.asset,instId:position.instId,valueUsd:+value.toFixed(2),qty:position.total,last,avgPrice:avg||null,lossPct:lossPct==null?null:+lossPct.toFixed(2),bucket,action,paperRecovery,liveOrder:false};
}

async function getExistingRecoveryPreview({env=process.env,fetchImpl=fetch}={}){
  const status=await getTradingStatus({env,fetchImpl});
  if(!status.connected)return {ok:false,status,positions:[]};
  const holdings=await getExistingHoldings({env,fetchImpl,minUsd:5});
  const positions=holdings.map(buildRecoveryPolicy).sort((a,b)=>b.valueUsd-a.valueUsd);
  return {ok:true,mode:mode(env),ts:new Date().toISOString(),positions,summary:{count:positions.length,totalUsd:+positions.reduce((s,x)=>s+x.valueUsd,0).toFixed(2),deepLoss:positions.filter(x=>x.bucket==="DEEP_LOSS_LOCK").length},warning:"PAPER ONLY - temporary recovery targets are previews; BTC is excluded and no sell order is sent"};
}

module.exports={mode,getTradingStatus,placeSpotLimit,runPaperSelfTest,getExistingHoldings,getExistingRecoveryPreview,buildRecoveryPolicy,buildPaperRecoveryTargets};
