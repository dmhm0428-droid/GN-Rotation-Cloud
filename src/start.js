"use strict";

const {spawn}=require("node:child_process");

const PROVIDERS=["PERPLEXITY","XAI","DEEPSEEK","ANTHROPIC","GEMINI"];

function aiEnv(){
  const env={...process.env,AI_ANALYSIS_ENABLED:"true"};
  for(const name of PROVIDERS){
    env[`${name}_ENABLED`]=env[`${name}_API_KEY`]?"true":"false";
  }
  return env;
}

function runAi(){
  const enabled=PROVIDERS.filter(name=>process.env[`${name}_API_KEY`]);
  if(!enabled.length){
    console.warn("GN AI scheduler: no provider API keys found in dashboard environment");
    return;
  }
  const child=spawn(process.execPath,["src/ai-runner.js"],{env:aiEnv(),stdio:"inherit"});
  child.on("exit",code=>{
    if(code!==0)console.error(`GN AI scheduler exited with code ${code}`);
  });
}

const server=spawn(process.execPath,["src/server.js"],{env:process.env,stdio:"inherit"});
server.on("exit",code=>process.exit(code??0));

// Run once shortly after boot, then every 15 minutes. This makes the existing
// dashboard service itself the fallback AI runner, so GN does not depend on a
// separately-created Render Cron before AI results reach Supabase.
setTimeout(runAi,10000);
setInterval(runAi,15*60*1000).unref();

for(const sig of ["SIGTERM","SIGINT"]){
  process.on(sig,()=>{
    if(!server.killed)server.kill(sig);
  });
}
