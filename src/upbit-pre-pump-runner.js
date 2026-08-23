"use strict";

const {scanPrePump}=require("./pre-pump-scanner");
const {savePrePumpScan}=require("./pre-pump-store");

async function enrichKrwPrices(rows,{fetchImpl=fetch}={}){
  if(!rows.length)return rows;
  const markets=rows.map(row=>row.market).join(",");
  try{
    const response=await fetchImpl(`https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(markets)}`,{headers:{Accept:"application/json","User-Agent":"GN-Pre-Pump-Runner-v1"}});
    if(!response.ok)return rows;
    const tickers=await response.json();
    const prices=new Map((tickers||[]).map(row=>[row.market,Number(row.trade_price)]));
    return rows.map(row=>({...row,krwPrice:Number.isFinite(prices.get(row.market))?prices.get(row.market):null}));
  }catch{return rows;}
}

function formatResult(row){
  return {
    market:row.market,
    score:row.score,
    status:row.state,
    krwPrice:row.krwPrice??null,
    return5m:row.return5m,
    return15m:row.return15m,
    turnoverGrowth15m:row.turnoverGrowth15m
  };
}

async function runUpbitPrePump({scanner=scanPrePump,save=savePrePumpScan,env=process.env,fetchImpl=fetch,...scanOptions}={}){
  const results=await scanner({...scanOptions,fetchImpl});
  const top3=await enrichKrwPrices(results.slice(0,3),{fetchImpl});
  try{await save({candidates:top3,env});}catch{}
  return top3.map(formatResult);
}

if(require.main===module){
  runUpbitPrePump()
    .then(results=>console.log(JSON.stringify(results,null,2)))
    .catch(error=>{console.error(`Pre-Pump scan failed: ${error?.message||"unknown error"}`);process.exitCode=1;});
}

module.exports={enrichKrwPrices,formatResult,runUpbitPrePump};
