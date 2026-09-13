"use strict";

const {createClient}=require("@supabase/supabase-js");
const {buildEventLead}=require("./event-lead-source");

function db(){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

async function loadSignals(client){
  const since=new Date(Date.now()-60*86400000).toISOString();
  const {data,error}=await client.from("gn_event_lead_signals").select("*").gte("observed_at",since).order("observed_at",{ascending:false});
  if(error)throw error;
  const rows=data||[],calendar=[],by=new Map();
  for(const row of rows){
    const symbol=String(row.symbol||"").toUpperCase();if(!symbol)continue;
    if(row.source_type==="calendar"&&row.signal_type==="event_date"&&!calendar.some(x=>String(x.symbol).toUpperCase()===symbol))calendar.push(row);
    if(!by.has(symbol))by.set(symbol,[]);by.get(symbol).push(row);
  }
  return {calendar,by};
}

async function persist(client,item){
  const s=item.signal;
  const row={
    symbol:item.symbol,market:item.market,ts:new Date().toISOString(),event_name:item.eventName,event_date:item.eventDate,
    days_to_event:s.daysToEvent,event_lead_score:s.score,event_lead_stage:s.stage,event_lead_eligible:s.eligible,
    price_ignited:s.priceIgnited,upstream_count:s.upstreamCount,signals:{...item.eventLead,reasons:s.reasons},raw:{price:item.price,github:item.github,external:item.external}
  };
  const {error}=await client.from("gn_event_lead_latest").upsert(row,{onConflict:"symbol"});if(error)throw error;
  return row;
}

async function runOnce({client=db(),fetchImpl=fetch}={}){
  const {calendar,by}=await loadSignals(client);const results=[];
  for(const cal of calendar){
    const symbol=String(cal.symbol||"").toUpperCase();
    try{results.push(await persist(client,await buildEventLead(symbol,cal,by.get(symbol)||[],{fetchImpl})));}
    catch(error){results.push({symbol,error:String(error?.message||error)});}
  }
  try{
    await client.from("gn_runs").insert({started_at:new Date().toISOString(),source_status:{source:"event_lead_v1",watchlist:results.map(x=>({symbol:x.symbol,stage:x.event_lead_stage,score:x.event_lead_score,eligible:x.event_lead_eligible,daysToEvent:x.days_to_event,priceIgnited:x.price_ignited}))}});
  }catch{}
  return results;
}

if(require.main===module){runOnce().then(r=>{console.log(JSON.stringify({eventLead:r},null,2));}).catch(e=>{console.error(e);process.exitCode=1;});}
module.exports={runOnce,loadSignals};
