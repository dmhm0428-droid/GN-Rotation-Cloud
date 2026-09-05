"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");
function patchHtml(html){
  if(typeof html!=="string")return html;
  return html.replace("<title>GN PIVOT · 단타</title>","<title>GN PIVOT</title>");
}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
