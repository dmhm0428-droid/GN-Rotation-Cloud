"use strict";

class AiProviderError extends Error{
  constructor(code,message){super(message);this.name="AiProviderError";this.code=code;}
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function systemPrompt(provider){
  const common="Analyze the supplied GN market snapshot as read-only context. Never recommend or create orders. Return exactly one minified JSON object and nothing else: {summary:string,sentiment:'risk_off'|'neutral'|'risk_on',confidence:number,signals:string[]}. No markdown, no code fence, no preface. Distinguish observed facts from inference. If a datum cannot be verified, do not invent it.";
  if(provider?.name!=="perplexity")return `${common} Use only the supplied snapshot. Add GN_POLICY_SCORE:0 and GN_WAR_OVERRIDE:false to signals because no external current-event verification is requested from this provider.`;
  const weeklyBundle="For the 2026-08-24 through 2026-08-30 GN priority window, treat these as one linked risk bundle and check them together before scoring: (1) NVIDIA earnings/guidance and AI-capex read-through; (2) Jackson Hole/Fed communication and any policy-rate repricing; (3) US Treasury 2Y/10Y/30Y yields, curve, auctions, liquidity and Treasury/Bessent actions; (4) White House/Trump fiscal, tariff or market-sensitive policy; (5) oil plus Iran/Middle-East geopolitical escalation, with direct war handled only by GN_WAR_OVERRIDE; (6) DXY and USDKRW; (7) BTC/ETH/SOL relative strength, crypto ETF/institutional flows, stablecoin/liquidity and market breadth. Do not double-count correlated moves: identify the dominant driver, transmission path, and whether the signal is confirmed by at least two independent market channels. Always include GN_WEEKLY_BUNDLE:<risk_off|mixed|risk_on> and GN_WEEKLY_DRIVER:<brief dominant driver> in signals.";
  return `${common} You are also the GN current-event sentinel. Using your current web/news capability, check only market-moving developments that are fresh and relevant as of the request time: White House and President Trump policy statements/actions, Treasury and Secretary Bessent, Federal Reserve/FOMC and Fed speakers, US Treasury yields/liquidity, Congress plus SEC/CFTC crypto policy, major Wall Street/ETF institutional flows, USD/DXY and USDKRW-sensitive policy, and major regulatory or fiscal announcements. ${weeklyBundle} Score the verified non-war policy/macro backdrop from -2 (strong risk-off) to +2 (strong risk-on). War or direct kinetic geopolitical escalation is NOT a normal score input: if a verified new war/escalation is severe enough to invalidate normal market scoring, set GN_WAR_OVERRIDE:true; otherwise false. Always include these exact machine-readable signal strings: GN_POLICY_SCORE:<-2|-1|0|1|2>, GN_WAR_OVERRIDE:<true|false>, GN_POLICY_FACTORS:<brief verified factors>, GN_WEEKLY_BUNDLE:<risk_off|mixed|risk_on>, and GN_WEEKLY_DRIVER:<brief dominant driver>. Do not treat rumors or stale headlines as verified events.`;
}
function buildPayload(provider,input){
  const prompt=systemPrompt(provider);
  if(provider.kind==="anthropic"){
    return {
      model:provider.model,
      max_tokens:Math.max(provider.maxOutputTokens,512),
      thinking:{type:"disabled"},
      system:prompt,
      messages:[{role:"user",content:[{type:"text",text:`GN snapshot:\n${JSON.stringify(input)}\n\nReturn only the JSON object.`}]}]
    };
  }
  if(provider.kind==="gemini"){
    return {
      systemInstruction:{parts:[{text:prompt}]},
      contents:[{role:"user",parts:[{text:JSON.stringify(input)}]}],
      generationConfig:{
        maxOutputTokens:Math.max(provider.maxOutputTokens,512),
        responseMimeType:"application/json",
        thinkingConfig:{thinkingLevel:"low"}
      }
    };
  }
  const maxTokens=provider.name==="perplexity"?Math.max(provider.maxOutputTokens,768):provider.name==="deepseek"?Math.max(provider.maxOutputTokens,512):provider.maxOutputTokens;
  const payload={model:provider.model,messages:[{role:"system",content:prompt},{role:"user",content:JSON.stringify(input)}],max_tokens:maxTokens,stream:false};
  if(provider.name==="perplexity"){
    payload.response_format={
      type:"json_schema",
      json_schema:{
        schema:{
          type:"object",
          properties:{
            summary:{type:"string"},
            sentiment:{type:"string",enum:["risk_off","neutral","risk_on"]},
            confidence:{type:"number",minimum:0,maximum:1},
            signals:{type:"array",items:{type:"string"}}
          },
          required:["summary","sentiment","confidence","signals"],
          additionalProperties:false
        }
      }
    };
  }
  if(provider.name==="deepseek"){
    payload.thinking={type:"disabled"};
    payload.response_format={type:"json_object"};
  }
  return payload;
}
function responseText(provider,body){
  if(provider.kind==="anthropic")return body?.content?.filter(x=>x?.type==="text").map(x=>x.text||"").join("");
  if(provider.kind==="gemini")return body?.candidates?.[0]?.content?.parts?.filter(x=>!x?.thought).map(x=>x?.text||"").join("");
  return body?.choices?.[0]?.message?.content;
}
function normalizeAnalysis(text){
  let raw=String(text||"").trim();
  raw=raw.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/i,"").trim();
  const first=raw.indexOf("{");const last=raw.lastIndexOf("}");
  if(first>=0&&last>first)raw=raw.slice(first,last+1);
  let value;
  try{value=JSON.parse(raw);}catch{throw new AiProviderError("INVALID_RESPONSE","Provider response was not valid JSON");}
  const sentiment=["risk_off","neutral","risk_on"].includes(value.sentiment)?value.sentiment:"neutral";
  const confidence=Math.max(0,Math.min(1,Number(value.confidence)||0));
  return {summary:String(value.summary||"").slice(0,1000),sentiment,confidence,signals:Array.isArray(value.signals)?value.signals.slice(0,12).map(x=>String(x).slice(0,300)):[]};
}
function providerErrorCode(provider,status,body){
  const msg=String(body?.error?.message||body?.message||"").toLowerCase();
  if(provider.kind==="anthropic"){
    if(/credit balance|billing|purchase credits|insufficient credit/.test(msg))return "ANTHROPIC_BILLING_REQUIRED";
    if(/model/.test(msg)&&/not found|invalid|unavailable|access/.test(msg))return "ANTHROPIC_MODEL_ACCESS";
  }
  if(provider.kind==="gemini"){
    if(/model/.test(msg)&&/not found|unsupported/.test(msg))return "GEMINI_MODEL_ACCESS";
    if(/quota|billing|resource exhausted/.test(msg))return "GEMINI_QUOTA_OR_BILLING";
    if(status===503||/temporarily unavailable|service unavailable|unavailable/.test(msg))return "GEMINI_UNAVAILABLE";
  }
  const raw=body?.error?.type||body?.error?.status||body?.type||"";
  const safe=String(raw).toUpperCase().replace(/[^A-Z0-9_]+/g,"_").slice(0,48);
  return safe?`${provider.name.toUpperCase()}_${safe}`:`HTTP_${status}`;
}
async function fetchTransport({provider,endpoint,apiKey,payload,timeoutMs}){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    let url=endpoint;
    if(provider.name==="perplexity"&&/^https:\/\/api\.perplexity\.ai\/chat\/completions\/?$/i.test(url))url="https://api.perplexity.ai/v1/sonar";
    let headers={"Content-Type":"application/json","Accept":"application/json"};
    if(provider.kind==="anthropic")headers={...headers,"x-api-key":apiKey,"anthropic-version":"2023-06-01"};
    else if(provider.kind==="gemini"){url=`${endpoint}/models/${encodeURIComponent(provider.model)}:generateContent`;headers={...headers,"x-goog-api-key":apiKey};}
    else headers={...headers,"Authorization":`Bearer ${apiKey}`};
    const response=await fetch(url,{method:"POST",signal:controller.signal,headers,body:JSON.stringify(payload)});
    const body=await response.json().catch(()=>null);
    if(!response.ok)throw new AiProviderError(providerErrorCode(provider,response.status,body),`Provider returned HTTP ${response.status}`);
    return {body,usage:body?.usage||body?.usageMetadata||{}};
  }catch(error){if(error?.name==="AbortError")throw new AiProviderError("TIMEOUT","Provider request timed out");throw error;}
  finally{clearTimeout(timer);}
}
function transientGeminiError(error){return ["GEMINI_UNAVAILABLE","HTTP_500","HTTP_502","HTTP_503","TIMEOUT"].includes(error?.code);}
async function invokeProvider(provider,input,transport=fetchTransport){
  if(!provider.enabled)return {provider:provider.name,model:provider.model,status:"disabled"};
  if(!provider.apiKey)throw new AiProviderError("MISSING_KEY",`${provider.name} API key is missing`);
  if(provider.estimatedCostUsd>provider.maxCostUsd)throw new AiProviderError("COST_LIMIT",`${provider.name} request exceeds its cost limit`);
  const run=async p=>{
    const payload=buildPayload(p,input);
    const result=await transport({provider:p,endpoint:p.endpoint,apiKey:p.apiKey,payload,timeoutMs:p.timeoutMs});
    return {provider:p.name,model:p.model,status:"success",...normalizeAnalysis(responseText(p,result.body)),usage:sanitizeUsage(result.usage),costUsd:p.estimatedCostUsd};
  };
  if(provider.kind==="gemini"){
    let lastError;
    for(let attempt=0;attempt<4;attempt++){
      try{return await run(provider);}catch(error){lastError=error;if(!transientGeminiError(error)||attempt===3)throw error;await sleep([1000,3000,7000][attempt]);}
    }
    throw lastError;
  }
  if(provider.kind==="anthropic"){
    try{return await run(provider);}catch(error){if(error?.code!=="INVALID_RESPONSE")throw error;await sleep(800);return run({...provider,maxOutputTokens:Math.max(provider.maxOutputTokens,768)});}
  }
  if(provider.name==="perplexity"){
    try{return await run(provider);}catch(error){if(error?.code!=="INVALID_RESPONSE")throw error;await sleep(500);return run({...provider,maxOutputTokens:Math.max(provider.maxOutputTokens,1024)});}
  }
  if(provider.name==="deepseek"){
    try{return await run(provider);}catch(error){if(error?.code!=="INVALID_RESPONSE")throw error;await sleep(500);return run({...provider,maxOutputTokens:Math.max(provider.maxOutputTokens,768)});}
  }
  return run(provider);
}
function sanitizeUsage(usage){
  const aliases={prompt_tokens:["prompt_tokens","promptTokenCount","input_tokens","inputTokens"],completion_tokens:["completion_tokens","candidatesTokenCount","output_tokens","outputTokens"],total_tokens:["total_tokens","totalTokenCount"]};
  const out={};
  for(const [key,names] of Object.entries(aliases)){
    const found=names.map(n=>usage?.[n]).find(v=>Number.isFinite(Number(v)));
    if(found!=null)out[key]=Number(found);
  }
  return out;
}

module.exports={AiProviderError,buildPayload,fetchTransport,invokeProvider,normalizeAnalysis,sanitizeUsage};
