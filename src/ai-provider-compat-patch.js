"use strict";

// Runtime compatibility patch for mandatory five-AI verification.
// xAI Responses API supports structured outputs through text.format.
// Gemini Search grounding can return INVALID_RESPONSE when JSON MIME output is
// forced together with google_search. Keep grounding enabled, but let the model
// emit plain text containing the requested JSON; providers.js already extracts
// and validates the JSON object strictly.
const originalFetch=global.fetch;
if(typeof originalFetch==="function"&&!global.__gnAiProviderCompat){
  global.__gnAiProviderCompat=true;
  global.fetch=async function(input,init={}){
    const url=typeof input==="string"?input:String(input?.url||input||"");
    if(url==="https://api.x.ai/v1/responses"&&typeof init?.body==="string"){
      try{
        const body=JSON.parse(init.body);
        body.text={...(body.text||{}),format:{
          type:"json_schema",
          name:"gn_money_footprint_verification",
          strict:true,
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
        }};
        init={...init,body:JSON.stringify(body)};
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
