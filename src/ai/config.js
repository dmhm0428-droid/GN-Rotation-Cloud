"use strict";

const PROVIDERS = {
  perplexity: { env: "PERPLEXITY", model: "sonar", endpoint: "https://api.perplexity.ai/chat/completions", estimatedCostUsd: 0.005 },
  xai: { env: "XAI", model: "grok-4.3", endpoint: "https://api.x.ai/v1/chat/completions", estimatedCostUsd: 0.003 },
  deepseek: { env: "DEEPSEEK", model: "deepseek-v4-flash", endpoint: "https://api.deepseek.com/chat/completions", estimatedCostUsd: 0.001 }
};

function bool(value, fallback=false){
  if(value==null||value==="")return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}
function number(value, fallback, min, max){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;
}
function loadAiConfig(env=process.env){
  const enabled=bool(env.AI_ANALYSIS_ENABLED,false);
  const providers={};
  for(const [name,base] of Object.entries(PROVIDERS)){
    const p=base.env;
    providers[name]={name,enabled:enabled&&bool(env[`${p}_ENABLED`],false),apiKey:env[`${p}_API_KEY`]||"",endpoint:base.endpoint,model:base.model,
      timeoutMs:number(env[`${p}_TIMEOUT_MS`],15000,1000,60000),maxOutputTokens:number(env[`${p}_MAX_OUTPUT_TOKENS`],256,1,1024),
      maxCostUsd:number(env[`${p}_MAX_COST_USD`],0.01,0,1),estimatedCostUsd:base.estimatedCostUsd};
  }
  return {enabled,maxCostUsdPerRun:number(env.AI_MAX_COST_USD_PER_RUN,0.03,0,3),maxInputChars:number(env.AI_MAX_INPUT_CHARS,12000,1000,50000),providers};
}

module.exports={loadAiConfig,PROVIDERS};
