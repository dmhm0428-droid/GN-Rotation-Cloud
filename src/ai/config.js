"use strict";

const PROVIDERS = {
  perplexity: { env: "PERPLEXITY", kind: "openai", model: "sonar", endpoint: "https://api.perplexity.ai/chat/completions", estimatedCostUsd: 0.005 },
  xai: { env: "XAI", kind: "openai", model: "grok-4.3", endpoint: "https://api.x.ai/v1/chat/completions", estimatedCostUsd: 0.003 },
  deepseek: { env: "DEEPSEEK", kind: "openai", model: "deepseek-v4-flash", endpoint: "https://api.deepseek.com/chat/completions", estimatedCostUsd: 0.001 },
  anthropic: { env: "ANTHROPIC", kind: "anthropic", model: "claude-sonnet-4-20250514", endpoint: "https://api.anthropic.com/v1/messages", estimatedCostUsd: 0.008 },
  gemini: { env: "GEMINI", kind: "gemini", model: "gemini-2.5-flash", endpoint: "https://generativelanguage.googleapis.com/v1beta", estimatedCostUsd: 0.002 }
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
    providers[name]={
      name,
      kind:base.kind,
      enabled:enabled&&bool(env[`${p}_ENABLED`],false),
      apiKey:env[`${p}_API_KEY`]||"",
      endpoint:env[`${p}_ENDPOINT`]||base.endpoint,
      model:env[`${p}_MODEL`]||base.model,
      timeoutMs:number(env[`${p}_TIMEOUT_MS`],15000,1000,60000),
      maxOutputTokens:number(env[`${p}_MAX_OUTPUT_TOKENS`],256,1,2048),
      maxCostUsd:number(env[`${p}_MAX_COST_USD`],0.02,0,1),
      estimatedCostUsd:base.estimatedCostUsd
    };
  }
  return {
    enabled,
    maxCostUsdPerRun:number(env.AI_MAX_COST_USD_PER_RUN,0.05,0,3),
    maxInputChars:number(env.AI_MAX_INPUT_CHARS,12000,1000,50000),
    providers
  };
}

module.exports={loadAiConfig,PROVIDERS};
