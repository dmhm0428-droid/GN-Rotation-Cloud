"use strict";

class AiProviderError extends Error{
  constructor(code,message){super(message);this.name="AiProviderError";this.code=code;}
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function systemPrompt(){
  return "Analyze the supplied GN market snapshot as read-only context. Never recommend or create orders. Return JSON only: {summary:string,sentiment:'risk_off'|'neutral'|'risk_on',confidence:number,signals:string[]}.";
}
function buildPayload(provider,input){
  if(provider.kind==="anthropic"){
    return {
      model:provider.model,
      max_tokens:provider.maxOutputTokens,
      system:systemPrompt(),
      messages:[{role:"user",content:[{type:"text",text:JSON.stringify(input)}]}]
    };
  }
  if(provider.kind==="gemini"){
    return {
      systemInstruction:{parts:[{text:systemPrompt()}]},
      contents:[{role:"user",parts:[{text:JSON.stringify(input)}]}],
      generationConfig:{
        maxOutputTokens:Math.max(provider.maxOutputTokens,512),
        responseMimeType:"application/json",
        thinkingConfig:{thinkingLevel:"low"}
      }
    };
  }
  const payload={model:provider.model,messages:[{role:"system",content:systemPrompt()},{role:"user",content:JSON.stringify(input)}],max_tokens:provider.maxOutputTokens,stream:false};
  if(provider.name==="deepseek")payload.thinking={type:"disabled"};
  return payload;
}
function responseText(provider,body){
  if(provider.kind==="anthropic")return body?.content?.find(x=>x?.type==="text")?.text;
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
  return {summary:String(value.summary||"").slice(0,1000),sentiment,confidence,signals:Array.isArray(value.signals)?value.signals.slice(0,10).map(x=>String(x).slice(0,300)):[]};
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
    let headers={"Content-Type":"application/json","Accept":"application/json"};
    if(provider.kind==="anthropic"){
      headers={...headers,"x-api-key":apiKey,"anthropic-version":"2023-06-01"};
    }else if(provider.kind==="gemini"){
      url=`${endpoint}/models/${encodeURIComponent(provider.model)}:generateContent`;
      headers={...headers,"x-goog-api-key":apiKey};
    }else{
      headers={...headers,"Authorization":`Bearer ${apiKey}`};
    }
    const response=await fetch(url,{method:"POST",signal:controller.signal,headers,body:JSON.stringify(payload)});
    const body=await response.json().catch(()=>null);
    if(!response.ok)throw new AiProviderError(providerErrorCode(provider,response.status,body),`Provider returned HTTP ${response.status}`);
    return {body,usage:body?.usage||body?.usageMetadata||{}};
  }catch(error){if(error?.name==="AbortError")throw new AiProviderError("TIMEOUT","Provider request timed out");throw error;}
  finally{clearTimeout(timer);}
}
function transientGeminiError(error){
  return ["GEMINI_UNAVAILABLE","HTTP_500","HTTP_502","HTTP_503","TIMEOUT"].includes(error?.code);
}
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
      try{return await run(provider);}catch(error){
        lastError=error;
        if(!transientGeminiError(error)||attempt===3)throw error;
        await sleep([1000,3000,7000][attempt]);
      }
    }
    throw lastError;
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
