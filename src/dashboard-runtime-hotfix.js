"use strict";

// Runtime compatibility bridge for the final dashboard.
// This is injected after final-dashboard-patch has replaced the base <body>,
// so legacy policy UI patches can safely call simpleAction without crashing.
const expressPath=require.resolve("express");
const previousExpress=require("express");

const SCRIPT=`<script id="gn-dashboard-runtime-hotfix-v1">(function(){
  if(typeof window.simpleAction!=="function"){
    window.simpleAction=function(raw,score){
      var s=String(raw||"").toUpperCase();
      var v=Number(score);
      if(s.indexOf("SELL")>=0||s.indexOf("EXIT")>=0||s.indexOf("손절")>=0||s.indexOf("매도")>=0)return {text:"팔아라",cls:"bad"};
      if(s.indexOf("NO_CHASE")>=0||s.indexOf("추격금지")>=0||s.indexOf("매수금지")>=0)return {text:"사지 마라",cls:"bad"};
      if(s.indexOf("ENTRY")>=0||s.indexOf("BUY")>=0||s.indexOf("추가매수")>=0||s.indexOf("확인매수")>=0)return {text:"사라",cls:"good"};
      if(s.indexOf("SCOUT")>=0||s.indexOf("WAIT")>=0||s.indexOf("대기")>=0||s.indexOf("관찰")>=0||s.indexOf("검증중")>=0)return {text:"기다려",cls:"warn"};
      if(Number.isFinite(v)){if(v>=72)return {text:"사라",cls:"good"};if(v<30)return {text:"사지 마라",cls:"bad"};}
      return {text:"기다려",cls:"warn"};
    };
  }
})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("<title>GN PIVOT</title>")||html.includes("gn-dashboard-runtime-hotfix-v1"))return html;
  return html.replace("</body>",SCRIPT+"</body>");
}

function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{
    const send=res.send.bind(res);
    res.send=function(body){return send(patchHtml(body));};
    next();
  });
  return app;
}

Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
