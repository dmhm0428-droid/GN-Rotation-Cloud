"use strict";

// Compatibility shim for the dashboard injector.
// The main dashboard HTML currently identifies itself as "GN PIVOT", while
// etf-dashboard-patch.js still guards on the older marker "GN 시장 전체 감시".
// Add the old marker invisibly so the existing Capital Flow / Rescue / ETF
// injector can run without replacing or deleting any current dashboard UI.

const expressPath=require.resolve("express");
const priorExpress=require("express");

function addLegacyMarker(html){
  if(typeof html!=="string")return html;
  if(!html.includes("GN PIVOT"))return html;
  if(html.includes("GN 시장 전체 감시"))return html;
  return html.replace("</body>",'<span style="display:none" aria-hidden="true">GN 시장 전체 감시</span></body>');
}

function wrappedExpress(...args){
  const app=priorExpress(...args);
  app.use((req,res,next)=>{
    const originalSend=res.send.bind(res);
    res.send=function(body){return originalSend(addLegacyMarker(body));};
    next();
  });
  return app;
}

Object.assign(wrappedExpress,priorExpress);
require.cache[expressPath].exports=wrappedExpress;
