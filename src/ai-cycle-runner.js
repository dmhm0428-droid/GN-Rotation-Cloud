"use strict";
const entry=require("./ai-entry-runner");
const policy=require("./policy-ai-runner");
async function main(){const entryResult=await entry.main().catch(error=>({error:String(error?.code||error?.message||error)}));const policyResult=await policy.main().catch(error=>({error:String(error?.code||error?.message||error)}));console.log(JSON.stringify({entry:entryResult,policy:policyResult}));}
if(require.main===module)main().catch(error=>{console.error(error?.stack||error?.message||error);process.exitCode=1;});
module.exports={main};
