"use strict";

const expressPath=require.resolve("express");
const previousExpress=require("express");
const {createClient}=require("@supabase/supabase-js");
const {applyEventLeadToTop3}=require("./event-lead-policy");
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

async function enrich(body){
  if(!body||typeof body!=="object"||Array.isArray(body))return body;
  const rows=Array.isArray(body.cryptoRadar)?body.cryptoRadar:[];
  const symbols=[...new Set(rows.map(r=>String(r?.market||"").replace(/^KRW-/,"")).filter(Boolean))];
  const {data,error}=symbols.length?await db.from("gn_event_lead_latest").select("*").in("symbol",symbols):{data:[],error:null};
  if(error)return {...body,eventLeadFeedError:String(error.message||error)};
  const by=new Map((data||[]).map(x=>[String(x.symbol||""),x]));
  const cryptoRadar=rows.map(row=>{
    const symbol=String(row?.market||"").replace(/^KRW-/,"");const hit=by.get(symbol);
    if(!hit)return applyEventLeadToTop3(row);
    const signals=hit.signals||{};
    const merged={...row,eventLead:{...signals,daysToEvent:hit.days_to_event,return3d:row.return3d,return7d:row.return7d,volume20dRatio:signals.volume20dRatio},eventLeadSource:{ts:hit.ts,eventName:hit.event_name,eventDate:hit.event_date,stage:hit.event_lead_stage,score:hit.event_lead_score,eligible:hit.event_lead_eligible,upstreamCount:hit.upstream_count,priceIgnited:hit.price_ignited}};
    return applyEventLeadToTop3(merged);
  });
  const watch=(data||[]).filter(x=>x.event_lead_eligible===true&&!symbols.includes(String(x.symbol||""))).map(x=>({market:`KRW-${x.symbol}`,eventLeadSource:{ts:x.ts,eventName:x.event_name,eventDate:x.event_date,stage:x.event_lead_stage,score:x.event_lead_score,eligible:true,upstreamCount:x.upstream_count,priceIgnited:x.price_ignited},eventLead:x.signals||{},eventLeadEligible:true,eventLeadScore:Number(x.event_lead_score)||0,eventLeadStage:x.event_lead_stage,entryAllowed:false,strictImmediate:false,scannerStatus:"EVENT_LEAD"}));
  return {...body,cryptoRadar,eventLeadWatch:watch,eventLeadUpdatedAt:(data||[]).map(x=>x.ts).sort().at(-1)||null};
}

function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{
    if(req.path==="/api/live-summary"){
      const json=res.json.bind(res);
      res.json=async body=>json(await enrich(body));
    }
    next();
  });
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
module.exports={enrich};
