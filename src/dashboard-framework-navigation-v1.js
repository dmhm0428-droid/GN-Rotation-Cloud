"use strict";
const {createFrameworkPolicy}=require('./gn-framework-screen-policy');
const {runFrameworkResults}=require('./dashboard-framework-results-client');
const CLIENT_JS='('+runFrameworkResults.toString()+')('+createFrameworkPolicy.toString()+');';
const STYLE='<style id="gn-framework-layout-v1">#gn-framework-home-v1{margin-top:18px}.gnFrameworkGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}.gnFrameworkGrid>button,.gnResultCard,.gnGateDetail,.gnResultMarket{background:#11161c;border:1px solid #34495f;border-radius:14px;padding:16px;color:#eef2f6;text-align:left}.gnFrameworkGrid>button{cursor:pointer}.gnFrameworkGrid b,.gnResultCard b{display:block;font-size:19px}.gnFrameworkGrid strong,.gnResultCard strong{display:block;color:#ffd166;margin:8px 0}.gnFrameworkGrid small,.gnResultCard small,.gnResultMarket small{display:block;color:#9baab9;line-height:1.7}.gnFrameworkNav,.gnSectorTabs{display:flex;flex-wrap:wrap;align-items:center;gap:9px;margin:14px 0}.gnFrameworkNav button,.gnSectorTabs button{padding:9px 13px;background:#172231;border:1px solid #395b80;border-radius:10px;color:#eef2f6;cursor:pointer}.gnSectorTabs button[aria-pressed=true]{background:#1477e8}#gn-framework-live-details{border:1px solid #2d3945;border-radius:12px;padding:14px;margin:12px 0}#gn-framework-live-details>summary{cursor:pointer}.gnGateRow{display:flex;flex-wrap:wrap;gap:5px;margin:12px 0}.gate{font-size:11px;padding:3px 6px;border:1px solid #48576b;border-radius:6px;color:#b6c6d6}.gate.PASS{color:#67d49a}.gate.FAIL{color:#ff8d8d}.gnGateDetails{display:grid;gap:9px;margin:12px 0}.gnGateDetail p{font-size:13px;color:#bdc8d2}.gnGateDetail small{font-size:12px;color:#9baab9}.gnResultMarket{display:grid;gap:8px}.gnResultMarket span{font-size:13px}#gn-framework-home-v1 button:focus-visible{outline:2px solid #65aaff}[hidden]{display:none!important}@media(max-width:560px){.gnFrameworkGrid{grid-template-columns:1fr}}</style>';
function patchHtml(html){
 if(typeof html!=="string"||!html.includes("GN PIVOT")||!html.includes('id="tabBody"')||html.includes('id="gn-framework-navigation-v1"'))return html;
 return html.replace("</body>",STYLE+'<script id="gn-framework-navigation-v1">'+CLIENT_JS+'</script></body>');
}
function install(){const expressPath=require.resolve("express");const previousExpress=require("express");
 function wrappedExpress(...args){const app=previousExpress(...args);app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(req.path==="/"?patchHtml(body):body);};next();});return app;}
 Object.assign(wrappedExpress,previousExpress);require.cache[expressPath].exports=wrappedExpress;
}
if(process.env.GN_FRAMEWORK_PATCH_TEST!=="1")install();
module.exports={patchHtml,CLIENT_JS};
