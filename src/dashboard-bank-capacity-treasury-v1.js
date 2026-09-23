"use strict";

const expressPath=require.resolve("express");
const previousExpress=require("express");

const POLICY={
  asOf:"2026-09-23",
  bessentBowman:{
    treasuryLever:"Bessent/Treasury: 발행 믹스(빌·쿠폰), 현금잔고(TGA), 바이백으로 국채시장 유동성과 딜러 재고 부담을 조절",
    fedLever:"Bowman/Fed supervision: 스트레스테스트·SCB·대형은행 자본규칙의 예측가능성과 위험민감도를 높여 은행의 자본계획/대출·중개 여력에 영향",
    link:"국채 공급이 늘어도 딜러·은행의 대차대조표 여력이 넓어지면 Treasury·repo 중개 병목이 줄고, 그 다음 기업대출/사모신용 파트너십으로 자금이 이동할 수 있음",
    caveat:"eSLR 완화는 주로 저위험·저수익 Treasury/repo 중개 제약 완화이며, 일반 기업대출 확대는 위험가중자본·SCB·예금/조달비용까지 함께 개선돼야 함."
  },
  treasury:{
    q3NetBorrowingB:739,
    q4NetBorrowingB:628,
    endSepTgaTargetB:950,
    endDecTgaTargetB:850,
    couponPlan:"현 수준의 명목 쿠폰·FRN 경매 규모를 최소 향후 몇 개 분기 유지",
    nextFinancingEstimate:"2026-11-02",
    nextQuarterlyRefunding:"2026-11-04",
    source:"U.S. Treasury Aug. 3/5, 2026 Quarterly Refunding"
  },
  bankCapital:{
    eslrEffective:"2026-04-01",
    eslr:"미국 GSIB의 강화 보완레버리지비율(eSLR) 수정으로 Treasury·repo 같은 저위험 중개에서의 레버리지 제약 완화",
    aggregateCapital:"Fed는 수정 규칙이 영향받는 지주회사 Tier 1 요구자본을 합산 기준 2% 미만 낮추며 전체 자본 수준은 대체로 유지될 것으로 추정",
    stressTest:"Bowman은 2개년 스트레스테스트 평균을 SCB에 반영해 변동성을 절반으로 줄이되 aggregate required capital은 크게 바꾸지 않는다고 설명",
    pending:"2026년 말까지 위험가중자본·GSIB surcharge 추가 개편을 마무리할 계획이라고 Bowman이 9월 18일 발언",
    source:"Federal Reserve 2025-11-25 / Bowman 2026-09-18"
  },
  privateCredit:{
    blackrockHps:"BlackRock은 HPS를 통해 대형 사모신용 플랫폼 보유",
    citiHps:"Citi와 BlackRock HPS는 2026년 약 $17.5B 규모 EMEA 사모신용 프로그램 출범",
    source:"Reuters 2026-05-18"
  }
};

const BENEFICIARIES=[
  {ticker:"JPM",name:"JPMorgan",tier:"직접",channel:"GSIB·국채 딜러·대형 대출",why:"eSLR/시장중개 완화의 직접 경로 + 기업대출/자본시장 연결"},
  {ticker:"C",name:"Citigroup",tier:"직접+연결",channel:"GSIB·국채 딜러·사모신용 파트너",why:"은행 대차대조표 + BlackRock HPS와의 $17.5B 프로그램으로 은행-사모신용 연결이 가장 명확"},
  {ticker:"BAC",name:"Bank of America",tier:"직접",channel:"GSIB·국채 딜러·기업대출",why:"국채 중개와 대형 기업대출 여력 확대 경로"},
  {ticker:"GS",name:"Goldman Sachs",tier:"직접",channel:"GSIB·딜러·자본시장",why:"Treasury/repo·채권 발행·시장중개 비중이 높아 국채시장 구조 변화에 민감"},
  {ticker:"MS",name:"Morgan Stanley",tier:"직접",channel:"GSIB·딜러·자산관리",why:"시장중개 + 자산관리/대체투자 연결"},
  {ticker:"BLK",name:"BlackRock",tier:"간접/2차",channel:"채권 AUM·iShares·HPS private credit",why:"은행 규제 완화의 직접 대상은 아니지만 채권시장 거래 확대와 은행-사모신용 공동대출을 흡수"}
];

async function yahooQuote(symbol){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),4500);
  try{
    const u=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
    const r=await fetch(u,{headers:{"user-agent":"Mozilla/5.0 GN-PIVOT/1.0","accept":"application/json"},signal:c.signal});
    if(!r.ok)throw Error(`HTTP ${r.status}`);
    const p=await r.json(),m=p?.chart?.result?.[0]?.meta||{},price=Number(m.regularMarketPrice),prev=Number(m.chartPreviousClose??m.previousClose);
    const changePct=(Number.isFinite(price)&&Number.isFinite(prev)&&prev!==0)?(price/prev-1)*100:null;
    return {price:Number.isFinite(price)?price:null,changePct:Number.isFinite(changePct)?changePct:null,tradedAt:m.regularMarketTime?new Date(m.regularMarketTime*1000).toISOString():null,source:"YAHOO_FINANCE_CHART"};
  }catch(e){return {price:null,changePct:null,tradedAt:null,source:"UNAVAILABLE",error:String(e?.name==="AbortError"?"QUOTE_TIMEOUT":e?.message||e)}}finally{clearTimeout(timer)}
}

async function api(req,res){
  const quotes=await Promise.all(BENEFICIARIES.map(x=>yahooQuote(x.ticker)));
  res.set("Cache-Control","no-store");
  res.json({ts:new Date().toISOString(),policy:POLICY,beneficiaries:BENEFICIARIES.map((x,i)=>({...x,quote:quotes[i]})),path:[
    "Treasury 발행·TGA·바이백",
    "국채금리·repo·딜러 재고 부담",
    "eSLR/SCB/위험가중자본 규칙",
    "대형은행 대차대조표·중개/대출 capacity",
    "기업대출·자본시장·private credit 공동대출",
    "실적/현금흐름 좋은 기업으로 자금 선별"
  ]});
}

const STYLE=`<style id="gn-bank-capacity-style">
#gnBankCapacity{margin:14px 0;padding:14px;border:1px solid #354352;border-radius:16px;background:#0f141a;color:#eef3f7}
#gnBankCapacity .head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
#gnBankCapacity .title{font-size:17px;font-weight:950}.stage{font-size:23px;font-weight:950;margin-top:4px}
#gnBankCapacity .muted{font-size:11px;color:#8996a3}.line{font-size:12px;color:#b7c2cc;line-height:1.55;margin-top:5px}
#gnBankCapacity .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:11px}
#gnBankCapacity .card{padding:11px;border:1px solid #293540;border-radius:12px;background:#121920}
#gnBankCapacity .good{color:#5ada91}.warn{color:#ffd166}.bad{color:#ff7272}
#gnBankCapacity .path{margin-top:10px;padding-top:9px;border-top:1px solid #28333d;font-size:11px;line-height:1.65;color:#aeb8c2}
#gnBankCapacity .rows{margin-top:9px}.row{padding:8px 0;border-top:1px solid #26313b}.row b{font-size:13px}
@media(max-width:620px){#gnBankCapacity .grid{grid-template-columns:1fr}}
</style>`;

const SCRIPT=`<script id="gn-bank-capacity-v1">(function(){
function esc(v){return String(v==null?'':v).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function n(v,d){var x=Number(v);return Number.isFinite(x)?x.toFixed(d==null?1:d):'--'}
function px(q){return q&&Number.isFinite(Number(q.price))?'$'+Number(q.price).toFixed(2)+' ('+n(q.changePct)+'%)':'--'}
function mount(){if(document.getElementById('gnBankCapacity'))return;var box=document.createElement('section');box.id='gnBankCapacity';box.innerHTML='<div class="head"><div><div class="title">Bessent × Bowman · 국채발행 → 은행 대출/중개 capacity</div><div class="stage warn">WATCH · 구조 연결</div><div class="line">Treasury 공급을 누가 흡수하고, 은행 자본규제가 그 흡수·대출 능력을 얼마나 넓히는지 추적</div></div><div class="muted">TREASURY / BANK CAPITAL / PRIVATE CREDIT</div></div><div class="grid"><div class="card" id="gnBB"></div><div class="card" id="gnTreasury"></div></div><div class="rows" id="gnBeneficiaries"></div><div class="path" id="gnBankPath"></div>';var anchor=document.getElementById('gnPrivateCreditQuality')||document.getElementById('gnInvestmentLink')||document.getElementById('gnBigPicture');if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(box,anchor.nextSibling);else{var wrap=document.querySelector('.wrap')||document.querySelector('main')||document.body;wrap.insertBefore(box,wrap.firstChild)}}
async function load(){mount();try{var r=await fetch('/api/bank-capacity-treasury?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);var d=await r.json(),p=d.policy||{},bb=p.bessentBowman||{},t=p.treasury||{},bc=p.bankCapital||{},pc=p.privateCredit||{};var a=document.getElementById('gnBB');if(a)a.innerHTML='<b>Bessent × Bowman 연결</b><div class="line">'+esc(bb.treasuryLever)+'</div><div class="line">'+esc(bb.fedLever)+'</div><div class="line good">'+esc(bb.link)+'</div><div class="muted" style="margin-top:6px">'+esc(bb.caveat)+'</div>';var b=document.getElementById('gnTreasury');if(b)b.innerHTML='<b>다음 국채발행 체크</b><div class="line">Q3 순차입 $'+n(t.q3NetBorrowingB,0)+'B · Q4 $'+n(t.q4NetBorrowingB,0)+'B</div><div class="line">TGA 9월말 $'+n(t.endSepTgaTargetB,0)+'B → 12월말 $'+n(t.endDecTgaTargetB,0)+'B</div><div class="line">다음 Financing estimate '+esc(t.nextFinancingEstimate)+' · Refunding '+esc(t.nextQuarterlyRefunding)+'</div><div class="line warn">'+esc(bc.eslr)+'</div><div class="muted" style="margin-top:6px">'+esc(bc.pending)+'</div>';var rows=document.getElementById('gnBeneficiaries');if(rows)rows.innerHTML='<b>수혜 연결 감시</b>'+((d.beneficiaries||[]).map(function(x){return '<div class="row"><b>'+esc(x.ticker)+' · '+esc(x.name)+' · '+esc(x.tier)+'</b><div class="line">'+esc(x.channel)+' · 현재 '+px(x.quote)+'</div><div class="muted">'+esc(x.why)+'</div></div>'}).join(''));var path=document.getElementById('gnBankPath');if(path)path.innerHTML='<b>전달경로</b> · '+(d.path||[]).map(esc).join(' → ')+'<br><b>BlackRock 연결</b> · '+esc(pc.blackrockHps)+' · '+esc(pc.citiHps)+'<br><span class="muted">판정 규칙: 국채발행 증가만으로 수혜 확정하지 않음. Treasury auction tail/10Y·30Y 금리, repo, 은행주 상대강도, 대출성장, SCB/자본규칙 변화가 같은 방향일 때 READY로 상향.</span>';}catch(e){var x=document.querySelector('#gnBankCapacity .stage');if(x)x.textContent='재조회 중'}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){mount();load()});else{mount();load()}setInterval(load,60000);window.gnBankCapacity=load;
})();</script>`;

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("gn-bank-capacity-v1"))return html;
  let out=html;
  if(out.includes("</head>"))out=out.replace("</head>",STYLE+"</head>");
  return out.replace("</body>",SCRIPT+"</body>");
}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.get("/api/bank-capacity-treasury",api);
  app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});
  return app;
}
Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
