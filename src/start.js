"use strict";

const {spawn}=require("node:child_process");

const PROVIDERS=["PERPLEXITY","XAI","DEEPSEEK","ANTHROPIC","GEMINI"];

function aiEnv(){
  const env={...process.env,AI_ANALYSIS_ENABLED:"true"};
  // Always enable the five configured providers. If a secret is missing or a
  // provider rejects a request, ai-runner persists that provider's error row
  // in gn_ai_analyses instead of silently producing no data.
  for(const name of PROVIDERS)env[`${name}_ENABLED`]="true";
  return env;
}

function runAi(){
  const child=spawn(process.execPath,["src/ai-runner.js"],{env:aiEnv(),stdio:"inherit"});
  child.on("exit",code=>{
    if(code!==0)console.error(`GN AI scheduler exited with code ${code}`);
  });
  child.on("error",error=>console.error("GN AI scheduler spawn error",error?.message||error));
}

const server=spawn(process.execPath,["src/server.js"],{env:process.env,stdio:"inherit"});
server.on("exit",code=>process.exit(code??0));

// Run once shortly after boot, then every 15 minutes. The dashboard service is
// the canonical fallback so the five-provider analysis does not depend on a
// separately-created Render Cron service.
setTimeout(runAi,10000);
setInterval(runAi,15*60*1000).unref();

for(const sig of ["SIGTERM","SIGINT"]){
  process.on(sig,()=>{
    if(!server.killed)server.kill(sig);
  });
}
