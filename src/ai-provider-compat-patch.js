"use strict";

// Runtime compatibility patch for mandatory five-AI verification.
// xAI: use the broadly available Chat Completions API instead of Responses
// search-tool mode, which can return 403 when the key lacks tool entitlement.
// Gemini: keep Search grounding, but avoid JSON MIME + search incompatibility.
const originalFetch=global.fetch;
if(typeof originalFetch==="function"&&!global.__gnAiProviderCompat){
  global.__gnAiProviderCompat=true;
  global.fetch=async function(input,init={}){
    let url=typeof input==="string"?input:String(input?.url||input||"");
    if(url==="https://api.x.ai/v1/responses"&&typeof init?.body==="string"){
      try{
        const body=JSON.parse(init.body);
        const msgs=Array.isArray(body.input)?body.input.map(x=>({role:x.role||"user",content:typeof x.content==="string"?x.content:String(x.content||"")})):[];
        const chat={
          model:body.model,
          messages:msgs,
          max_tokens:Math.max(Number(body.max_output_tokens)||0,768),
          stream:false,
          response_format:{type:"json_object"}
        };
        url="https://api.x.ai/v1/chat/completions";
        input=url;
        init={...init,body:JSON.stringify(chat)};
      }catch{}
    }
    if(/generativelanguage\.googleapis\.com\/.+:generateContent/i.test(url)&&typeof init?.body==="string"){
      try{
        const body=JSON.parse(init.body);
        const hasGoogleSearch=Array.isArray(body?.tools)&&body.tools.some(t=>t&&typeof t==="object"&&t.google_search);
        if(hasGoogleSearch&&body?.generationConfig){
          delete body.generationConfig.responseMimeType;
          body.generationConfig.maxOutputTokens=Math.max(Number(body.generationConfig.maxOutputTokens)||0,1024);
        }
        init={...init,body:JSON.stringify(body)};
      }catch{}
    }
    return originalFetch(input,init);
  };
}
