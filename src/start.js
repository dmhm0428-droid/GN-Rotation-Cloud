"use strict";

const {spawn}=require("node:child_process");
const path=require("node:path");

const PROVIDERS=["PERPLEXITY","XAI","DEEPSEEK","ANTHROPIC","GEMINI"];
let aiRunning=false;
let assistantRunning=false;
let retryTimer=null;
let assistantRetryTimer=null;

function aiEnv(){
  const env={...process.env,AI_ANALYSIS_ENABLED:"true"};
  for(const name of PROVIDERS)env[`${name}_ENABLED`]="true";
  return env;
}

function runAi(){
  if(aiRunning)return;
  aiRunning=true;
  const child=spawn(process.execPath,["src/ai-runner.js"],{env:aiEnv(),stdio:"inherit"});
  child.on("exit",code=>{
    aiRunning=false;
    if(code!==0){
      console.error(`GN AI scheduler exited with code ${code}; retrying in 60s`);
      clearTimeout(retryTimer);
      retryTimer=setTimeout(runAi,60000);
    }
  });
  child.on("error",error=>{
    aiRunning=false;
    console.error("GN AI scheduler spawn error",error?.message||error);
    clearTimeout(retryTimer);
    retryTimer=setTimeout(runAi,60000);
  });
}

function runAssistant(){
  if(assistantRunning)return;
  assistantRunning=true;
  const child=spawn(process.execPath,["src/investment-assistant-runner.js"],{env:process.env,stdio:"inherit"});
  child.on("exit",code=>{
    assistantRunning=false;
    if(code!==0){
      console.error(`GN investment assistant exited with code ${code}; retrying in 60s`);
      clearTimeout(assistantRetryTimer);
      assistantRetryTimer=setTimeout(runAssistant,60000);
    }
  });
  child.on("error",error=>{
    assistantRunning=false;
    console.error("GN investment assistant scheduler spawn error",error?.message||error);
    clearTimeout(assistantRetryTimer);
    assistantRetryTimer=setTimeout(runAssistant,60000);
  });
}

const etfPreload=path.resolve(__dirname,"etf-dashboard-patch.js");
const markerPreload=path.resolve(__dirname,"dashboard-marker-patch.js");
const tradePlanPreload=path.resolve(__dirname,"trade-plan-dashboard-patch.js");
const okxTradePreload=path.resolve(__dirname,"okx-trading-dashboard-patch.js");
const top3PolicyPreload=path.resolve(__dirname,"top3-policy-patch.js");
const investmentAssistantPreload=path.resolve(__dirname,"investment-assistant-dashboard-patch.js");
const serverEnv={...process.env,NODE_OPTIONS:[process.env.NODE_OPTIONS,`--require=${etfPreload}`,`--require=${markerPreload}`,`--require=${tradePlanPreload}`,`--require=${okxTradePreload}`,`--require=${top3PolicyPreload}`,`--require=${investmentAssistantPreload}`].filter(Boolean).join(" ")};
const server=spawn(process.execPath,["src/server.js"],{env:serverEnv,stdio:"inherit"});
server.on("exit",code=>process.exit(code??0));

setTimeout(runAi,5000);
setTimeout(runAssistant,12000);
setInterval(runAi,15*60*1000).unref();
setInterval(runAssistant,15*60*1000).unref();

for(const sig of ["SIGTERM","SIGINT"]){
  process.on(sig,()=>{
    clearTimeout(retryTimer);
    clearTimeout(assistantRetryTimer);
    if(!server.killed)server.kill(sig);
  });
}
