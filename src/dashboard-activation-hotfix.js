"use strict";

// Hotfix: the final dashboard patch historically looked for id="hero",
// but the current base dashboard no longer contains that id. Insert a hidden
// marker only into the authenticated GN PIVOT dashboard HTML so the final
// dashboard renderer can activate. Login pages are intentionally excluded.
const expressPath=require.resolve("express");
const originalExpress=require("express");

function markDashboard(html){
  if(typeof html!=="string")return html;
  if(!html.includes("<title>GN PIVOT</title>"))return html;
  if(html.includes("<title>GN PIVOT 로그인</title>"))return html;
  if(html.includes('id="hero"'))return html;
  return html.replace("<body>",'<body><i id="hero" hidden></i>');
}

function wrappedExpress(...args){
  const app=originalExpress(...args);
  app.use((req,res,next)=>{
    const send=res.send.bind(res);
    res.send=function(body){return send(markDashboard(body));};
    next();
  });
  return app;
}

Object.assign(wrappedExpress,originalExpress);
require.cache[expressPath].exports=wrappedExpress;
