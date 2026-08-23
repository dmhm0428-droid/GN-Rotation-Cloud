"use strict";

const {scanPrePump}=require("./pre-pump-scanner");
const {savePrePumpScan}=require("./pre-pump-store");

function formatResult(row){
  return {
    market:row.market,
    score:row.score,
    status:row.state,
    return5m:row.return5m,
    return15m:row.return15m,
    turnoverGrowth15m:row.turnoverGrowth15m
  };
}

async function runUpbitPrePump({scanner=scanPrePump,save=savePrePumpScan,env=process.env,...scanOptions}={}){
  const results=await scanner(scanOptions);
  const top3=results.slice(0,3);
  try{await save({candidates:top3,env});}catch{}
  return top3.map(formatResult);
}

if(require.main===module){
  runUpbitPrePump()
    .then(results=>console.log(JSON.stringify(results,null,2)))
    .catch(error=>{console.error(`Pre-Pump scan failed: ${error?.message||"unknown error"}`);process.exitCode=1;});
}

module.exports={formatResult,runUpbitPrePump};
