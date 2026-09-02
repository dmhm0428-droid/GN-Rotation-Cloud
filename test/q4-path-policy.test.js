"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {buildQ4Path}=require("../src/q4-path-policy");

const now=Date.parse("2026-09-02T12:00:00Z");
function row(ts,extra={}){return {ts,...extra};}
function base(){
  return {
    now,
    market:row("2026-09-02T11:58:00Z",{market_score:31,spot_breadth100:.29}),
    macro:row("2026-09-02T11:57:00Z",{rates_score:37,policy_score:27,commodities_score:47,volatility_score:42,components:{RATE_HIKE_PATH:{risk:73,path:{september:{hike_25bp_probability:70.2},december:{additional_hike_probability:null}}}}}),
    marketHistory:[row("2026-09-02T11:58:00Z",{market_score:31}),row("2026-09-02T11:00:00Z",{market_score:34})],
    macroHistory:[row("2026-09-02T11:57:00Z",{rates_score:37}),row("2026-09-02T11:00:00Z",{rates_score:43})],
    coinRows:[
      row("2026-09-02T11:58:00Z",{coin:"BTC",krw_price:105000000}),row("2026-09-02T10:30:00Z",{coin:"BTC",krw_price:104500000}),
      row("2026-09-02T11:58:00Z",{coin:"ETH",krw_price:3260000}),row("2026-09-02T10:30:00Z",{coin:"ETH",krw_price:3240000})
    ],
    events:{}
  };
}

test("current risk-off combination is classified as panic expansion, not a calendar buy",()=>{
  const out=buildQ4Path(base());
  assert.equal(out.state,"PANIC_EXPANSION");
  assert.ok(out.panic.score>=75);
  assert.ok(out.reversal.score<60);
});

test("improving rates, breadth, footprint and crypto lows trigger reversal detection",()=>{
  const x=base();
  x.market={...x.market,market_score:48,spot_breadth100:.52};
  x.marketHistory=[row("2026-09-02T11:58:00Z",{market_score:48}),row("2026-09-02T11:00:00Z",{market_score:40})];
  x.macro={...x.macro,rates_score:52,policy_score:48,commodities_score:53,components:{RATE_HIKE_PATH:{risk:52,path:{september:{hike_25bp_probability:55},december:{additional_hike_probability:35}}}}};
  x.macroHistory=[row("2026-09-02T11:57:00Z",{rates_score:52}),row("2026-09-02T11:00:00Z",{rates_score:44})];
  x.coinRows=[row("2026-09-02T11:58:00Z",{coin:"BTC",krw_price:107000000}),row("2026-09-02T10:30:00Z",{coin:"BTC",krw_price:104000000}),row("2026-09-02T11:58:00Z",{coin:"ETH",krw_price:3320000}),row("2026-09-02T10:30:00Z",{coin:"ETH",krw_price:3250000})];
  const out=buildQ4Path(x);
  assert.equal(out.state,"REVERSAL_DETECTED");
  assert.ok(out.reversal.score>=60);
});

test("reversal requires fresh data and fails closed when market data is stale",()=>{
  const x=base();x.market={...x.market,ts:"2026-09-02T10:00:00Z"};x.macro={...x.macro,ts:"2026-09-02T10:00:00Z"};
  const out=buildQ4Path(x);
  assert.equal(out.state,"DATA_WAIT");
});
