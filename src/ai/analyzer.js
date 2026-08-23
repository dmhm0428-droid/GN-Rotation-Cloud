"use strict";

const {invokeProvider}=require("./providers");

function safeError(error){return error?.code&&/^[A-Z0-9_]+$/.test(error.code)?error.code:"PROVIDER_ERROR";}
async function analyzeSnapshot(snapshot,config,{transport}={}){
  if(!config.enabled)return [];
  const serialized=JSON.stringify(snapshot);
  const input=serialized.length<=config.maxInputChars?snapshot:{truncated:true,snapshotText:serialized.slice(0,config.maxInputChars)};
  let reserved=0;
  const tasks=Object.values(config.providers).map(async provider=>{
    if(!provider.enabled)return {provider:provider.name,model:provider.model,status:"disabled"};
    if(reserved+provider.estimatedCostUsd>config.maxCostUsdPerRun)return {provider:provider.name,model:provider.model,status:"skipped",errorCode:"RUN_COST_LIMIT"};
    reserved+=provider.estimatedCostUsd;
    try{return await invokeProvider(provider,input,transport);}
    catch(error){return {provider:provider.name,model:provider.model,status:"error",errorCode:safeError(error)};}
  });
  return Promise.all(tasks);
}

module.exports={analyzeSnapshot};
