'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {runFrameworkResults}=require('../src/dashboard-framework-results-client');
const {createFrameworkPolicy}=require('../src/gn-framework-screen-policy');
const P=createFrameworkPolicy();
function complete(symbol,fail=false){const at=Date.now(),proof=()=>({verified:true,status:'PASS',sources:['source'],observed_at:new Date(at-1000).toISOString(),valid_until:new Date(at+60000).toISOString()});const gates=Object.fromEntries(P.STAGES.map(([k])=>[k,proof()]));gates.company_quality.checks=Object.fromEntries(P.QUALITY.map(([k])=>[k,proof()]));if(fail)gates.company_quality.checks.pricing_power.status='FAIL';Object.assign(gates.execution,{buy_krw:100,invalidation_krw:90,recovery_krw:120,review_at:new Date(at+60000).toISOString()});return {symbol,components:{gn_framework:gates}};}
test('only passed candidates render and a failed refresh removes an open passed stock',async()=>{
 const selectors=new Map();const root={innerHTML:'',querySelector(s){if(!selectors.has(s))selectors.set(s,{innerHTML:'',textContent:'',hidden:false});return selectors.get(s);},addEventListener(_,handler){this.handler=handler;}};
 const wrap={children:[],querySelector(){return null;},insertBefore(x){this.children.push(x);}};let first=true;
 const document={readyState:'complete',querySelector:()=>wrap,getElementById:()=>null,createElement(tag){if(tag==='section')return root;return {innerHTML:'',append(){},matches(){return false;}};}};
 const row=symbol=>({kind:'us',symbol,name:symbol+' company',sector:'전자·반도체',live_verification:{price:10,currency:'USD',price_verified:true,source:'https://query1.finance.yahoo.com/v8/finance/chart/'+symbol,tradedAt:new Date().toISOString()}});
 const context={document,window:{scrollTo(){}},MutationObserver:class{observe(){}},AbortController,setTimeout,clearTimeout,setInterval:()=>0,fetch:async url=>({ok:true,json:async()=>url.startsWith('/api/gn-market-candidates')?{items:[row('PASSCO'),row('FAILCO'),row('PENDINGCO')],coverage:{us:{discovered:5000,deep_checked:1}},published_at:new Date().toISOString()}:url.startsWith('/api/live-summary')?{reps:[...(first?[complete('PASSCO')]:[]),complete('FAILCO',true)]}:{items:[]}})};
 vm.createContext(context);vm.runInContext('('+runFrameworkResults.toString()+')('+createFrameworkPolicy.toString()+')',context);
 await new Promise(setImmediate);assert.match(selectors.get('[data-view]').innerHTML,/A 1 · B 0 · C 0/);assert.match(selectors.get('[data-market]').innerHTML,/GN 선행 레이더/);
 root.handler({target:{closest:()=>({hasAttribute:()=>false,dataset:{group:'us'}})}});
 const list=selectors.get('[data-view]').innerHTML;assert.match(list,/PASSCO company/);assert.doesNotMatch(list,/FAILCO|PENDINGCO|미충족|근거 보류/);
 root.handler({target:{closest:()=>({hasAttribute:()=>false,dataset:{symbol:'PASSCO'}})}});assert.match(selectors.get('[data-view]').innerHTML,/PASSCO company/);
 first=false;await context.window.refreshGN();const html=selectors.get('[data-view]').innerHTML;assert.match(html,/선별 후보 없음/);assert.doesNotMatch(html,/PASSCO|FAILCO|PENDINGCO/);
});
