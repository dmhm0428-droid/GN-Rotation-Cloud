"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");

const STOCK_SECTION='<div class="section" id="usStockFootprintSection"><div class="head"><b>미국주식 발자국</b><span class="muted">실제 자금흐름 상위 3</span></div><div id="usStockFlow" class="grid"></div></div>';

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("usStockFootprintSection"))return html;
  let out=html.replace('<b>돈의 방향</b>','<b>돈의 발자국</b>');
  const anchor='<div id="assetFlow" class="grid"></div></div>';
  if(out.includes(anchor))out=out.replace(anchor,anchor+STOCK_SECTION);
  return out;
}
function wrappedExpress(...args){const app=previousExpress(...args);app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});return app;}
Object.assign(wrappedExpress,previousExpress);require.cache[expressPath].exports=wrappedExpress;
