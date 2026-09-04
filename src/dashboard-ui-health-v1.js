"use strict";

// Public deployment health for the canonical GN PIVOT UI chain.
// Render verifies only the canonical display chain; optional provider/data failures
// must never mark the web UI itself unhealthy.
const fs=require("node:fs");
const path=require("node:path");
const expressPath=require.resolve("express");
const previousExpress=require("express");

const REQUIRED=[
  "dashboard-leading-top3-v2.js",
  "dashboard-authoritative-v1.js",
  "dashboard-live-summary-patch.js",
  "final-dashboard-patch.js"
];
const REVISION="GN_UI_CANONICAL_20260905_V2";

function uiHealth(req,res){
  const opts=String(process.env.NODE_OPTIONS||"");
  const checks={};
  for(const name of REQUIRED){
    checks[name]={
      preloaded:opts.includes(name),
      file:fs.existsSync(path.resolve(__dirname,name))
    };
  }
  const ok=Object.values(checks).every(x=>x.preloaded&&x.file);
  res.set("Cache-Control","no-store");
  return res.status(ok?200:503).json({ok,revision:REVISION,canonicalTop3Owner:"dashboard-leading-top3-v2",partialLoaderDisabled:true,checks,time:new Date().toISOString()});
}

function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.get("/health/ui",uiHealth);
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
