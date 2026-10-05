'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {runFrameworkResults}=require('../src/dashboard-framework-results-client');
const {createFrameworkPolicy}=require('../src/gn-framework-screen-policy');
test('the displayed stock candidates change with the market feed and preserve incomplete verdicts',async()=>{
 const selectors=new Map();const root={innerHTML:'',querySelector(s){if(!selectors.has(s))selectors.set(s,{innerHTML:'',textContent:'',hidden:false});return selectors.get(s);},addEventListener(_,handler){this.handler=handler;}};
 const wrap={children:[],querySelector(){return null;},insertBefore(x){this.children.push(x);}};let first=true;
 const document={readyState:'complete',querySelector:()=>wrap,getElementById:()=>null,createElement(tag){if(tag==='section')return root;return {innerHTML:'',append(){},matches(){return false;}};}};
 const row=symbol=>({kind:'us',symbol,name:symbol+' company',sector:'전자·반도체',live_verification:{price:10,currency:'USD',price_verified:true,source:'https://query1.finance.yahoo.com/v8/finance/chart/'+symbol,tradedAt:new Date().toISOString()}});
 const context={document,window:{scrollTo(){}},MutationObserver:class{observe(){}},AbortController,setTimeout,clearTimeout,setInterval:()=>0,fetch:async url=>({ok:true,json:async()=>url.startsWith('/api/gn-market-candidates')?{items:[row(first?'NEWONE':'NEXTONE')],coverage:{us:{discovered:5000,deep_checked:1}},published_at:new Date().toISOString()}:{items:[]}})};
 vm.createContext(context);vm.runInContext('('+runFrameworkResults.toString()+')('+createFrameworkPolicy.toString()+')',context);
 await new Promise(setImmediate);assert.match(selectors.get('[data-view]').innerHTML,/표시 후보 1개/);
 root.handler({target:{closest:()=>({hasAttribute:()=>false,dataset:{group:'us'}})}});
 assert.match(selectors.get('[data-view]').innerHTML,/NEWONE company/);assert.match(selectors.get('[data-view]').innerHTML,/전체 시장에 통과 종목이 없다는 뜻은 아님/);
 first=false;await context.window.refreshGN();const html=selectors.get('[data-view]').innerHTML;assert.match(html,/NEXTONE company/);assert.doesNotMatch(html,/NEWONE company/);assert.match(html,/판정 보류/);
});
