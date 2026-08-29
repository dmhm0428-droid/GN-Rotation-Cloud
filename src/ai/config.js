"use strict";

const PROVIDERS={
  perplexity:{env:"PERPLEXITY",kind:"openai",model:"sonar",endpoint:"https://api.perplexity.ai/v1/sonar",estimatedCostUsd:.005,timeoutMs:45000},
  xai:{env:"XAI",kind:"openai",model:"grok-4.3",endpoint:"https://api.x.ai/v1/chat/completions",estimatedCostUsd:.003,timeoutMs:45000},
  deepseek:{env:"DEEPSEEK",kind:"openai",model:"deepseek-v4-flash",endpoint:"https://api.deepseek.com/chat/completions",estimatedCostUsd:.001,timeoutMs:25000},
  anthropic:{env:"ANTHROPIC",kind:"anthropic",model:"claude-sonnet-5",endpoint:"https://api.anthropic.com/v1/messages",estimatedCostUsd:.008,timeoutMs:30000},
  gemini:{env:"GEMINI",kind:"gemini",model:"gemini-3.7-flash",endpoint:"https://generativelanguage.googleapis.com/v1beta",estimatedCostUsd:.002,timeoutMs:45000}
};
function bool(v,f=false){if(v==null||v==="")return f;return /^(1|true|yes|on)$/i.test(String(v));}
function number(v,f,min,max){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):f;}
function clean(v){return String(v??"").trim();}
function loadAiConfig(env=process.env){
  const enabled=bool(env.AI_ANALYSIS_ENABLED,false),providers={};
  for(const [name,base] of Object.entries(PROVIDERS)){
    const p=base.env;
    providers[name]={name,kind:base.kind,enabled:enabled&&bool(env[`${p}_ENABLED`],false),apiKey:clean(env[`${p}_API_KEY`]),endpoint:clean(env[`${p}_ENDPOINT`])||base.endpoint,model:clean(env[`${p}_MODEL`])||base.model,timeoutMs:number(env[`${p}_TIMEOUT_MS`],base.timeoutMs,1000,60000),maxOutputTokens:number(env[`${p}_MAX_OUTPUT_TOKENS`],512,1,2048),maxCostUsd:number(env[`${p}_MAX_COST_USD`],.02,0,1),estimatedCostUsd:base.estimatedCostUsd};
  }
  return {enabled,maxCostUsdPerRun:number(env.AI_MAX_COST_USD_PER_RUN,.05,0,3),maxInputChars:number(env.AI_MAX_INPUT_CHARS,30000,1000,50000),providers};
}
module.exports={loadAiConfig,PROVIDERS};
