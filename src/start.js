"use strict";

const {spawn}=require("node:child_process");

const PROVIDERS=["PERPLEXITY","XAI","DEEPSEEK","ANTHROPIC","GEMINI"];
let aiRunning=false;
let retryTimer=null;

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

const server=spawn(process.execPath,["src/server.js"],{env:process.env,stdio:"inherit"});
server.on("exit",code=>process.exit(code??0));

setTimeout(runAi,5000);
setInterval(runAi,15*60*1000).unref();

for(const sig of ["SIGTERM","SIGINT"]){
  process.on(sig,()=>{
    clearTimeout(retryTimer);
    if(!server.killed)server.kill(sig);
  });
}
