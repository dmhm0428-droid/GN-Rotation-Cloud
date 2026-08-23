"use strict";
const upbit=require("./exchanges/upbit");
const bithumb=require("./exchanges/bithumb");
const mexc=require("./exchanges/mexc");
const okx=require("./exchanges/okx");
const ADAPTERS={upbit,bithumb,mexc,okx};

async function loadExchange(name,{env=process.env,fetchImpl=fetch}={}){const adapter=ADAPTERS[name];if(!adapter)throw new Error(`Unknown exchange: ${name}`);try{const account=await adapter.balances({env,fetchImpl});if(!account.enabled)return {exchange:name,enabled:false,positions:[],error:null};const assets=account.balances.map(x=>x.asset);const priceMap=await adapter.prices(assets,{fetchImpl});const quote=(name==="upbit"||name==="bithumb")?"KRW":"USDT";const positions=account.balances.map(b=>({...b,quote,price:b.asset===quote?1:(priceMap[b.asset]??null),valueQuote:b.asset===quote?b.total:(priceMap[b.asset]==null?null:b.total*priceMap[b.asset])}));return {exchange:name,enabled:true,positions,error:null};}catch(e){return {exchange:name,enabled:true,positions:[],error:String(e.message||e)};}}
async function loadPortfolio(options={}){const names=options.exchanges||Object.keys(ADAPTERS);const results=await Promise.all(names.map(name=>loadExchange(name,options)));return {updatedAt:new Date().toISOString(),exchanges:results};}
module.exports={ADAPTERS,loadExchange,loadPortfolio};
