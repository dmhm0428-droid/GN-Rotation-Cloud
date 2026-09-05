"use strict";

const {spawn}=require("node:child_process");
const path=require("node:path");

const PROVIDERS=["PERPLEXITY","XAI","DEEPSEEK","ANTHROPIC","GEMINI"];
const aiProviderCompat=path.resolve(__dirname,"ai-provider-compat-patch.js");
let aiRunning=false;
let assistantRunning=false;
let retryTimer=null;
let assistantRetryTimer=null;

function aiEnv(){
  const env={...process.env,AI_ANALYSIS_ENABLED:"true"};
  for(const name of PROVIDERS)env[`${name}_ENABLED`]="true";
  if(!env.XAI_TIMEOUT_MS)env.XAI_TIMEOUT_MS="60000";
  if(!env.GEMINI_TIMEOUT_MS)env.GEMINI_TIMEOUT_MS="60000";
  env.NODE_OPTIONS=[process.env.NODE_OPTIONS,`--require=${aiProviderCompat}`].filter(Boolean).join(" ");
  return env;
}
function runAi(){
  if(aiRunning)return;aiRunning=true;
  const child=spawn(process.execPath,["src/ai-entry-runner.js"],{env:aiEnv(),stdio:"inherit"});
  child.on("exit",code=>{aiRunning=false;if(code!==0){console.error(`GN AI scheduler exited with code ${code}; retrying in 60s`);clearTimeout(retryTimer);retryTimer=setTimeout(runAi,60000);}});
  child.on("error",error=>{aiRunning=false;console.error("GN AI scheduler spawn error",error?.message||error);clearTimeout(retryTimer);retryTimer=setTimeout(runAi,60000);});
}
function runAssistant(){
  if(assistantRunning)return;assistantRunning=true;
  const child=spawn(process.execPath,["src/investment-assistant-runner.js"],{env:process.env,stdio:"inherit"});
  child.on("exit",code=>{assistantRunning=false;if(code!==0){console.error(`GN investment assistant exited with code ${code}; retrying in 60s`);clearTimeout(assistantRetryTimer);assistantRetryTimer=setTimeout(runAssistant,60000);}});
  child.on("error",error=>{assistantRunning=false;console.error("GN investment assistant scheduler spawn error",error?.message||error);clearTimeout(assistantRetryTimer);assistantRetryTimer=setTimeout(runAssistant,60000);});
}

// Response post-processing order is reverse preload order.
// Keep ONE authoritative full-dashboard renderer. Legacy/final full-body replacement layers
// are intentionally excluded because they can overwrite a working dashboard with placeholders.
// Crypto TOP3 UI has ONE owner only: dashboard-leading-top3-v2.
const preloads=[
  "dashboard-ui-health-v1.js",
  "dashboard-cleanup-watchlist-v1.js",
  "dashboard-leading-top3-v2.js",
  "dashboard-big-picture-v1.js",
  "dashboard-metals-live-v1.js",
  "dashboard-rotation-drilldown-v2.js",
  "dashboard-rotation-v1.js",
  "dashboard-authoritative-v1.js",
  "dashboard-live-summary-patch.js",
  "dashboard-etf-api-v1.js",
  "dashboard-resilience-patch.js",
  "dashboard-runtime-hotfix.js",
  "dashboard-hard-rescue.js",
  "dashboard-title-compat-v1.js",
  "dashboard-no-cache-v1.js"
].map(x=>path.resolve(__dirname,x));
const serverEnv={...process.env,NODE_OPTIONS:[process.env.NODE_OPTIONS,...preloads.map(x=>`--require=${x}`)].filter(Boolean).join(" ")};
const server=spawn(process.execPath,["src/server.js"],{env:serverEnv,stdio:"inherit"});
server.on("exit",code=>process.exit(code??0));
setTimeout(runAi,5000);setTimeout(runAssistant,12000);
setInterval(runAi,60*1000).unref();setInterval(runAssistant,60*1000).unref();
for(const sig of ["SIGTERM","SIGINT"]){process.on(sig,()=>{clearTimeout(retryTimer);clearTimeout(assistantRetryTimer);if(!server.killed)server.kill(sig);});}
