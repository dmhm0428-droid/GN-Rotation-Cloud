"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {calculateMetrics,highChasePenalty,rankCandidates,scanPrePump,scoreCandidates}=require("../src/pre-pump-scanner");

function candles({latest=103,old15=100,recentTurnover=200,previousTurnover=100}={}){
  const result=[];
  const base=Date.parse("2026-01-01T00:30:00Z");
  for(let i=0;i<31;i++){
    const minutesAgo=i;
    let price=old15;
    if(minutesAgo<15)price=old15+(latest-old15)*(15-minutesAgo)/15;
    result.push({candle_date_time_utc:new Date(base-minutesAgo*60000).toISOString().slice(0,19),trade_price:price,candle_acc_trade_price:minutesAgo<15?recentTurnover/15:previousTurnover/15});
  }
  return result;
}

function structuredCandles({mode="breakout",latest=102}={}){
  const result=[];
  const base=Date.parse("2026-01-01T01:00:00Z");
  for(let i=0;i<61;i++){
    let close=100;
    if(mode==="downtrend")close=latest+i*.08;
    else if(i<15)close=latest-i*.12;
    const volume=i<15?20:5;
    result.push({candle_date_time_utc:new Date(base-i*60000).toISOString().slice(0,19),trade_price:close,opening_price:close-.05,high_price:mode==="breakout"&&i>=15?101:close+.1,low_price:close-.2,candle_acc_trade_price:volume*close,candle_acc_trade_volume:volume});
  }
  return result;
}

test("calculates 5m, 15m, and recent turnover growth",()=>{
  const metric=calculateMetrics("KRW-AAA",candles());
  assert.ok(metric.return5m>0);
  assert.ok(Math.abs(metric.return15m-.03)<1e-9);
  assert.ok(Math.abs(metric.turnoverGrowth15m-1)<1e-9);
});

test("ranks early positive candidates and excludes already-pumped coins",()=>{
  const rows=[
    {market:"KRW-A",return5m:.02,return15m:.04,turnoverGrowth15m:2},
    {market:"KRW-B",return5m:.01,return15m:.03,turnoverGrowth15m:1},
    {market:"KRW-C",return5m:.08,return15m:.12,turnoverGrowth15m:5},
    {market:"KRW-D",return5m:-.01,return15m:.01,turnoverGrowth15m:3}
  ];
  const ranked=rankCandidates(rows);
  assert.deepEqual(ranked.map(row=>row.market),["KRW-A"]);
});

test("scans every KRW market across quotation timeframes and never touches order API",async()=>{
  const requested=[];
  const fetchImpl=async url=>{
    requested.push(url);
    const body=url.includes("/market/all")
      ?[{market:"KRW-AAA"},{market:"BTC-BBB"},{market:"KRW-CCC"}]
      :candles(url.includes("KRW-AAA")?{latest:104}:{latest:102,recentTurnover:150});
    return {ok:true,status:200,json:async()=>body};
  };
  const result=await scanPrePump({fetchImpl,sleep:async()=>{},batchSize:8});
  const candleRequests=requested.filter(url=>url.includes("/candles/"));
  assert.ok(candleRequests.length>=2);
  assert.ok(candleRequests.some(url=>url.includes("KRW-AAA")));
  assert.ok(candleRequests.some(url=>url.includes("KRW-CCC")));
  assert.ok(!candleRequests.some(url=>url.includes("BTC-BBB")));
  assert.ok(requested.every(url=>!url.includes("/orders")));
  assert.deepEqual(result.map(row=>row.market),["KRW-AAA"]);
});

test("returns at most three candidates",()=>{
  const rows=Array.from({length:8},(_,i)=>({market:`KRW-${i}`,return5m:.001*(i+1),return15m:.002*(i+1),turnoverGrowth15m:.1*(i+1)}));
  const ranked=rankCandidates(rows);
  assert.ok(ranked.length<=3);
  assert.ok(ranked.every(row=>row.score>=50&&["SCOUT","ENTRY"].includes(row.state)));
});

test("returns only SCOUT or ENTRY candidates scoring at least 50",()=>{
  const rows=[
    {market:"KRW-STRONG",return5m:.04,return15m:.08,turnoverGrowth15m:3,obvDirection:1,higherLow15m:true,resistanceProximity15m:-.01,structure1h:"sideways_breakout",highDistance1h:-.02},
    {market:"KRW-MID",return5m:.03,return15m:.06,turnoverGrowth15m:2,obvDirection:.7,higherLow15m:true,resistanceProximity15m:-.02,structure1h:"uptrend",highDistance1h:-.02},
    {market:"KRW-WAIT",return5m:.001,return15m:.002,turnoverGrowth15m:.01,obvDirection:-1,higherLow15m:false,resistanceProximity15m:-.2,structure1h:"downtrend",highDistance1h:-.02}
  ];
  const ranked=rankCandidates(rows);
  assert.ok(ranked.length<=3);
  assert.ok(ranked.every(row=>row.score>=50&&["SCOUT","ENTRY"].includes(row.state)));
  assert.ok(!ranked.some(row=>row.market==="KRW-WAIT"));
});

test("returns an empty array when no candidate meets the quality threshold",()=>{
  const ranked=rankCandidates([{market:"KRW-WAIT",return5m:.001,return15m:.002,turnoverGrowth15m:.01,obvDirection:0,higherLow15m:false,resistanceProximity15m:-.2,structure1h:"downtrend",highDistance1h:-.02}]);
  assert.deepEqual(ranked,[]);
});

test("detects positive OBV, higher lows, and a sideways breakout structure",()=>{
  const metric=calculateMetrics("KRW-EARLY",structuredCandles());
  assert.ok(metric.obvDirection>0);
  assert.equal(metric.higherLow15m,true);
  assert.ok(metric.resistanceProximity15m>=-.03);
  assert.equal(metric.structure1h,"sideways_breakout");
});

test("distinguishes a one-hour downtrend",()=>{
  const metric=calculateMetrics("KRW-DOWN",structuredCandles({mode:"downtrend",latest:95}));
  assert.equal(metric.structure1h,"downtrend");
});

test("calculates current distance from the recent one-hour high",()=>{
  const metric=calculateMetrics("KRW-HIGH",structuredCandles({latest:101}));
  assert.ok(metric.highDistance1h<=0);
  assert.ok(metric.highDistance1h>=-.005);
});

test("slightly penalizes candidates trading within half a percent of the one-hour high",()=>{
  const base={market:"KRW-BASE",return5m:.01,return15m:.03,turnoverGrowth15m:.5,obvDirection:.5,higherLow15m:false,resistanceProximity15m:-.01,structure1h:"neutral"};
  const near={...base,market:"KRW-NEAR",highDistance1h:-.003};
  const away={...base,market:"KRW-AWAY",highDistance1h:-.02};
  const ranked=scoreCandidates([near,away]);
  assert.equal(ranked.find(row=>row.market==="KRW-NEAR").highChasePenalty,3);
  assert.equal(ranked.find(row=>row.market==="KRW-AWAY").highChasePenalty,0);
  assert.ok(ranked.find(row=>row.market==="KRW-NEAR").score<ranked.find(row=>row.market==="KRW-AWAY").score);
});

test("blocks easy ENTRY after a short pump near the high",()=>{
  const penalty=highChasePenalty({return15m:.06,turnoverGrowth15m:2,highDistance1h:-.002,higherLow15m:false,structure1h:"neutral"});
  assert.deepEqual(penalty,{points:8,entryBlocked:true});
  const [ranked]=scoreCandidates([{market:"KRW-CHASE",return5m:.03,return15m:.06,turnoverGrowth15m:2,obvDirection:1,higherLow15m:false,resistanceProximity15m:0,structure1h:"neutral",highDistance1h:-.002}]);
  assert.equal(ranked.highChaseRisk,true);
  assert.notEqual(ranked.state,"ENTRY");
});

test("does not over-penalize a confirmed pullback and rebreak",()=>{
  const penalty=highChasePenalty({return15m:.06,turnoverGrowth15m:2,highDistance1h:-.002,higherLow15m:true,structure1h:"sideways_breakout",pullbackRebreak1h:true});
  assert.deepEqual(penalty,{points:1,entryBlocked:false});
});

test("structural confirmation improves the combined score",()=>{
  const common={return5m:.01,return15m:.03,turnoverGrowth15m:1};
  const ranked=scoreCandidates([
    {market:"KRW-CONFIRMED",...common,obvDirection:.8,higherLow15m:true,resistanceProximity15m:-.01,structure1h:"sideways_breakout"},
    {market:"KRW-WEAK",...common,obvDirection:-.8,higherLow15m:false,resistanceProximity15m:-.2,structure1h:"downtrend"}
  ]);
  assert.equal(ranked[0].market,"KRW-CONFIRMED");
  assert.ok(ranked[0].score>ranked[1].score);
});

test("excludes candidates already up ten percent or more",()=>{
  const ranked=rankCandidates([{market:"KRW-LATE",return5m:.04,return15m:.10,turnoverGrowth15m:4,obvDirection:1,higherLow15m:true,resistanceProximity15m:0,structure1h:"sideways_breakout"}]);
  assert.deepEqual(ranked,[]);
});

test("rewards rising OI, moderate funding, and early short liquidations",()=>{
  const common={return5m:.01,return15m:.03,turnoverGrowth15m:1,obvDirection:.5,higherLow15m:true,resistanceProximity15m:-.01,structure1h:"sideways_breakout"};
  const ranked=scoreCandidates([
    {market:"KRW-DERIVATIVE",...common},
    {market:"KRW-NEUTRAL",...common}
  ],{"KRW-DERIVATIVE":{oiGrowth:.06,fundingRate:.0002,shortLiquidationGrowth:2.5,longLiquidationGrowth:.1}});
  const boosted=ranked.find(row=>row.market==="KRW-DERIVATIVE");
  const neutral=ranked.find(row=>row.market==="KRW-NEUTRAL");
  assert.ok(boosted.derivativeScore>neutral.derivativeScore);
  assert.ok(boosted.score>neutral.score);
  assert.equal(boosted.derivativeDataAvailable,true);
  assert.equal(neutral.derivativeDataAvailable,false);
});

test("marks excessive positive funding as no-chase",()=>{
  const row={market:"KRW-HOT",return5m:.03,return15m:.08,turnoverGrowth15m:3,obvDirection:1,higherLow15m:true,resistanceProximity15m:0,structure1h:"sideways_breakout"};
  const [ranked]=scoreCandidates([row],{"KRW-HOT":{oiGrowth:.08,fundingRate:.001,shortLiquidationGrowth:3,longLiquidationGrowth:0}});
  assert.equal(ranked.state,"NO_CHASE");
});

test("marks a long-liquidation spike as no-chase",()=>{
  const row={market:"KRW-LONG-LIQ",return5m:.01,return15m:.03,turnoverGrowth15m:1,obvDirection:.5,higherLow15m:true,resistanceProximity15m:-.01,structure1h:"neutral"};
  const [ranked]=scoreCandidates([row],{"KRW-LONG-LIQ":{oiGrowth:.02,fundingRate:.0001,shortLiquidationGrowth:.2,longLiquidationGrowth:2.2}});
  assert.equal(ranked.state,"NO_CHASE");
});

test("missing derivative data remains neutral without errors",()=>{
  const row={market:"KRW-SPOT",return5m:.01,return15m:.02,turnoverGrowth15m:.5,obvDirection:.2,higherLow15m:true,resistanceProximity15m:-.02,structure1h:"neutral"};
  const [ranked]=scoreCandidates([row]);
  assert.equal(ranked.derivativeScore,50);
  assert.equal(ranked.derivativeDataAvailable,false);
  assert.ok(["WAIT","SCOUT","ENTRY"].includes(ranked.state));
});

test("isolates a rate-limited market and continues scanning other KRW markets",async()=>{
  let sleeps=0;
  const fetchImpl=async url=>{
    if(url.includes("/market/all"))return {ok:true,status:200,json:async()=>[{market:"KRW-OK"},{market:"KRW-RATE-LIMITED"}]};
    if(url.includes("KRW-RATE-LIMITED"))return {ok:false,status:429,json:async()=>({})};
    return {ok:true,status:200,json:async()=>candles({latest:103})};
  };
  const result=await scanPrePump({fetchImpl,batchSize:1,batchDelayMs:1,sleep:async()=>{sleeps++;}});
  assert.deepEqual(result,[]);
  assert.equal(sleeps,1);
});
