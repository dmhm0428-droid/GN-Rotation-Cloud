"use strict";

// Runtime compatibility patch for mandatory five-AI verification.
// xAI: keep the native Responses API so web_search + x_search remain available.
// The previous Chat Completions rewrite removed those tools and did not resolve 403.
// Gemini: keep Search grounding, but avoid JSON MIME + search incompatibility.
const originalFetch=global.fetch;
if(typeof originalFetch==="function"&&!global.__gnAiProviderCompat){
  global.__gnAiProviderCompat=true;
  global.fetch=async function(input,init={}){
    const url=typeof input==="string"?input:String(input?.url||input||"");
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
