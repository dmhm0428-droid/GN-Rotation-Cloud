"use strict";

// Operational/data warnings must not look like market-loss/trade-risk signals.
// True strategy risk keeps the canonical .bad red styling; provider/data issues are amber.
const expressPath=require.resolve("express");
const previousExpress=require("express");

const STYLE='<style id="gn-operational-status-color-v1">.gnProviderBad,.gnSectionError,[data-gn-provider-warning="1"]{color:#ffd166!important}.gnStaleNote{color:#ffd166!important}</style>';

function patchHtml(html){
  if(typeof html!=="string"||!html.includes('id="decisionHero"')||html.includes('gn-operational-status-color-v1'))return html;
  return html.replace('</body>',STYLE+'</body>');
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
