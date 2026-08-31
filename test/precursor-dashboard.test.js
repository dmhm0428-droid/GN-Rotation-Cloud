"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {actionFor,currentEpisode,mapRow,persistenceBucket,stageMeta}=require("../src/precursor-dashboard");

test("persistence buckets separate single, repeat2, repeat3+",()=>{
  assert.equal(persistenceBucket(1),"SINGLE");
  assert.equal(persistenceBucket(2),"REPEAT_2");
  assert.equal(persistenceBucket(3),"REPEAT_3_PLUS");
  assert.equal(persistenceBucket(8),"REPEAT_3_PLUS");
});

test("confirmed repeat is a monitoring signal, never an automatic buy",()=>{
  const stage=stageMeta("CONFIRMED_REPEAT_3",3);
  const a=actionFor({entryAllowed:false,status:"SCOUT",stage,repeat:3,expansion:{score:100,globalSpotOk:true,derivativesOk:true}});
  assert.equal(stage.label,"반복확정 3+");
  assert.equal(a.text,"우선감시");
  assert.equal(a.observationOnly,true);
});

test("ENTRY requires explicit entry_allowed before display can say entry verification",()=>{
  const stage=stageMeta("CONFIRMED_REPEAT_3",4);
  assert.equal(actionFor({entryAllowed:false,status:"ENTRY",stage,repeat:4,expansion:{score:100,globalSpotOk:true,derivativesOk:true}}).text,"우선감시");
  assert.equal(actionFor({entryAllowed:true,status:"ENTRY",stage,repeat:4,expansion:{score:100,globalSpotOk:true,derivativesOk:true}}).text,"진입검증");
});

test("current episode is matched to first-detection anchor, not stale prior episode",()=>{
  const row={market:"KRW-AAA",first_detected_at:"2026-09-01T00:30:00Z"};
  const outcomes=[
    {market:"KRW-AAA",episode_start_ts:"2026-08-31T22:00:00Z"},
    {market:"KRW-AAA",episode_start_ts:"2026-09-01T00:28:00Z"}
  ];
  assert.equal(currentEpisode(row,outcomes)?.episode_start_ts,"2026-09-01T00:28:00Z");
});

test("row mapping exposes repeat, expansion, MA and post-validation without changing SCOUT into buy",()=>{
  const row={
    market:"KRW-AAA",rank:1,score:100,status:"SCOUT",krw_price:105,first_detected_at:"2026-09-01T00:30:00Z",first_detected_price:100,rise_since_first:.05,
    details:{
      entry_allowed:false,five_ai_gate_ok:false,
      precursor:{confidence_stage:"REPEAT_2",persistence:{repeat_count_30m:2,consecutive_top3:2,top3_count_30m:2,top6_count_6h:4},ma_transition:{score:71,reasons:["MA_STACK_TRANSITION"]},archetype:"TAPE_STEALTH+IGNITION"},
      listing_expansion_evidence:{score:100,thesis:"해외 4곳 가격 확인 · 글로벌 현물 동조",global_spot_ok:true,derivatives_ok:true,onchain_ok:false,major_exchange_count:4}
    }
  };
  const outcomes=[{market:"KRW-AAA",episode_start_ts:"2026-09-01T00:28:00Z",ret_15m:.01,ret_30m:.02,ret_1h:.03,ret_3h:null,mfe_3h:null,mae_3h:null,outcome:null,completed_at:null}];
  const summaries=new Map([["REPEAT_2",{persistence_bucket:"REPEAT_2",episodes:20,n_1h:18,avg_1h_pct:1.2,win_1h_3pct:33.3,n_3h:15,avg_3h_pct:2.1,hit_3h_5pct:40,avg_mfe_3h_pct:6.4,avg_mae_3h_pct:-2.2}]]);
  const out=mapRow(row,outcomes,summaries);
  assert.equal(out.stageLabel,"반복 2회");
  assert.equal(out.repeatCount,2);
  assert.equal(out.expansion.score,100);
  assert.equal(out.expansion.globalSpotOk,true);
  assert.equal(out.expansion.onchainOk,false);
  assert.equal(out.maScore,71);
  assert.equal(out.postValidation.ret15m,1);
  assert.equal(out.validationStats.hit3h5Pct,40);
  assert.equal(out.precursorAction,"반복감시");
  assert.equal(out.observationOnly,true);
  assert.equal(out.riseSinceFirstPct,5);
});
