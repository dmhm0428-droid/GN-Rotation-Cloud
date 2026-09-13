"use strict";

function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,a=0,b=100){return Math.max(a,Math.min(b,v));}
function bool(v){return v===true;}

// EVENT LEAD is upstream of the existing TOP3 price/flow policy.
// Goal: detect a scheduled/being-created catalyst before price ignition.
// Do not treat a public event date alone as a signal.
function eventLeadSignal(row){
  const d=row?.details||{};
  const e=row?.eventLead||d.event_lead||{};
  const days=num(e.daysToEvent??row?.daysToEvent);
  const return60m=num(row?.return60m);
  const extension2h=num(row?.extensionFromLow2h);
  const return3d=num(e.return3d??row?.return3d);
  const return7d=num(e.return7d??row?.return7d);
  const volume20dRatio=num(e.volume20dRatio??row?.volume20dRatio);

  const releaseCandidate=bool(e.releaseCandidate||e.releaseTag||e.rcCreated);
  const testnetActive=bool(e.testnetActive||e.devnetActive||e.testActivation);
  const validatorAdoption=bool(e.validatorAdoption||e.nodeAdoption||e.clientUpgradeAdoption);
  const infraSupport=bool(e.exchangeSupport||e.walletSupport||e.infrastructureSupport);
  const treasuryWhale=bool(e.treasuryAction||e.foundationWalletAction||e.whaleAction);
  const officialDateConcrete=bool(e.officialDateConcrete||e.blockHeightConcrete||e.voteDateConcrete);

  const upstream=[releaseCandidate,testnetActive,validatorAdoption,infraSupport,treasuryWhale].filter(Boolean).length;
  const reasons=[];
  if(releaseCandidate)reasons.push("RC/release tag");
  if(testnetActive)reasons.push("testnet/devnet activation");
  if(validatorAdoption)reasons.push("validator/node adoption");
  if(infraSupport)reasons.push("exchange/infrastructure support");
  if(treasuryWhale)reasons.push("treasury/foundation/whale action");
  if(officialDateConcrete)reasons.push("concrete official schedule");

  // PRICE IGNITION D0: first meaningful expansion. Once ignited, EVENT LEAD cannot be a new TOP3 precursor.
  const priceIgnited=(return3d!=null&&return3d>=0.05)||(return7d!=null&&return7d>=0.10)||(return60m!=null&&return60m>=0.04)||(extension2h!=null&&extension2h>=0.05);
  const overheated=volume20dRatio!=null&&volume20dRatio>5;
  const windowOk=days==null||(days>=7&&days<=60);

  let score=0;
  score+=releaseCandidate?15:0;
  score+=testnetActive?20:0;
  score+=validatorAdoption?25:0;
  score+=infraSupport?18:0;
  score+=treasuryWhale?12:0;
  score+=officialDateConcrete?5:0;
  if(days!=null&&days>=14&&days<=45)score+=8;
  if(volume20dRatio!=null&&volume20dRatio>=1.2&&volume20dRatio<=3.5)score+=7;
  if(priceIgnited)score-=45;
  if(overheated)score-=25;
  if(!windowOk)score-=10;
  score=+clamp(score).toFixed(1);

  const eligible=upstream>=2&&score>=55&&!priceIgnited&&!overheated&&windowOk;
  return {
    available: upstream>0||officialDateConcrete,
    eligible,
    score,
    upstreamCount:upstream,
    daysToEvent:days,
    priceIgnited,
    volume20dRatio,
    reasons,
    stage: priceIgnited?"PRICE_IGNITED":eligible?"EVENT_LEAD":upstream>=1?"PRECURSOR_WATCH":"NO_SIGNAL"
  };
}

function applyEventLeadToTop3(row){
  const eventLead=eventLeadSignal(row);
  return {
    ...row,
    eventLead,
    eventLeadEligible:eventLead.eligible,
    eventLeadScore:eventLead.score,
    eventLeadStage:eventLead.stage,
    // Never promote solely because an event exists. This is an upstream boost only.
    eventLeadBoost:eventLead.eligible?Math.min(20,eventLead.score*0.2):0
  };
}

module.exports={eventLeadSignal,applyEventLeadToTop3};
