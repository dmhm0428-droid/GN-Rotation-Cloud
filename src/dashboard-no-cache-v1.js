"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{
    if(req.method==="GET"&&(req.path==="/"||req.path==="/login")){
      res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
      res.setHeader("Pragma","no-cache");
      res.setHeader("Expires","0");
      res.setHeader("Surrogate-Control","no-store");
      res.setHeader("X-GN-UI-Revision","GN_UI_CANONICAL_20260905_V4");
    }
    next();
  });
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
