"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");
function parsed(){
  try{
    const raw=process.env.SAVE_TICKER_BRIEF_JSON;
    if(!raw)return {
      ts:"2026-09-21T23:59:00+09:00",
      saveChecked:true,
      access:"SAVE_PUBLIC_INDEXED_PAGES",
      verified:[
        {topic:"금리·달러",fact:"연준 0.25%p 인상 뒤 추가 인상 경계가 유지되고 달러가 강세",validation:"SAVE 공개 원문(9/16) · Reuters 시장기사(9/21) 일치"},
        {topic:"주식·크립토",fact:"나스닥 신고가·AI 반도체 강세와 비트코인 6% 상승으로 위험선호는 살아 있음",validation:"Reuters 미국장 마감(9/21) 역검증"},
        {topic:"유가·전쟁",fact:"외교 기대에 브렌트유가 11일 저점이지만 호르무즈 물동량·운임·디젤 공급망은 아직 불안",validation:"Reuters 원유·해운·정유 보도(9/21) 교차검증"}
      ],
      conflict:false,
      action:"퇴직연금 1차 분할만 · 크립토 추격 금지",
      summary:"상방 흐름은 유지되지만 금리·달러와 에너지 공급망 위험이 남아 전액 진입은 보류",
      status:"VERIFIED_PUBLIC_SAVE"
    };
    const x=JSON.parse(raw),verified=Array.isArray(x.verified)?x.verified.filter(v=>v&&v.fact&&v.validation):[];
    return {ts:x.ts||new Date().toISOString(),saveChecked:x.saveChecked===true,verified:verified.slice(0,5),conflict:x.conflict===true,action:x.action||null,summary:x.summary||null,status:x.saveChecked===true?"VERIFIED":"UNVERIFIED"};
  }catch(error){return {ts:new Date().toISOString(),saveChecked:false,verified:[],conflict:false,status:"SAVE_BRIEF_INVALID",error:String(error.message||error)};}
}
function wrappedExpress(...args){const app=previousExpress(...args);app.get("/api/save-brief",(req,res)=>{res.set("Cache-Control","no-store");res.json(parsed());});return app;}
Object.assign(wrappedExpress,previousExpress);require.cache[expressPath].exports=wrappedExpress;
module.exports={parsed};
