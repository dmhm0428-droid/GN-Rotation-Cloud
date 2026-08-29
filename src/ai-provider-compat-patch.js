"use strict";

// Runtime compatibility patch for mandatory five-AI verification.
// xAI Responses API supports structured outputs through text.format.
// Force the GN audit schema so web/X tool calls still finish as parseable JSON.
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
    return originalFetch(input,init);
  };
}
