"use strict";

const expressPath=require.resolve("express");
const previousExpress=require("express");

const STYLE='<style id="gn-investment-link-style">'+
'#gnInvestmentLink{margin:14px 0;background:#0f141a;border:1px solid #354352;border-radius:18px;padding:15px}'+
'#gnInvestmentLink .gnHead{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}'+
'#gnInvestmentLink .gnTitle{font-size:17px;font-weight:950}'+
'#gnInvestmentLink .gnRev{font-size:10px;color:#7f8b97}'+
'#gnInvestmentLink .gnStage{font-size:25px;font-weight:950;margin-top:4px}'+
'#gnInvestmentLink .gnLine{font-size:12px;color:#a9b5c0;margin-top:4px;line-height:1.5}'+
'#gnInvestmentLink .gnGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:12px}'+
'#gnInvestmentLink .gnCard{background:#121920;border:1px solid #293540;border-radius:13px;padding:11px}'+
'#gnInvestmentLink .gnLabel{font-size:11px;color:#8896a3;font-weight:850}'+
'#gnInvestmentLink .gnValue{font-size:15px;font-weight:900;margin-top:4px}'+
'#gnInvestmentLink .gnMeta{font-size:11px;color:#93a0ac;line-height:1.45;margin-top:4px}'+
'#gnInvestmentLink .gnPolicy{margin-top:12px;border-top:1px solid #28333d;padding-top:8px}'+
'#gnInvestmentLink .gnPolicyRow{padding:8px 0;border-bottom:1px solid #202a33}'+
'#gnInvestmentLink .gnPolicyRow b{font-size:13px}'+
'#gnInvestmentLink .gnPolicyDetail{font-size:11px;color:#9da9b4;line-height:1.45;margin-top:4px}'+
'#gnInvestmentLink .gnRisk{margin-top:12px;padding:10px 11px;border:1px solid #303b46;border-radius:12px;background:#0d1217}'+
'#gnInvestmentLink .gnRisk b{font-size:13px}'+
'#gnInvestmentLink .gnRiskText{font-size:11px;color:#a1adb8;line-height:1.55;margin-top:5px}'+
'#gnInvestmentLink .good{color:#5ada91}#gnInvestmentLink .warn{color:#ffd166}#gnInvestmentLink .bad{color:#ff7272}'+
'@media(max-width:620px){#gnInvestmentLink .gnGrid{grid-template-columns:1fr}}'+
'</style>';

const SCRIPT='<script id="gn-investment-link-v1">(function(){'+
'var HEADS=[["LONG_BOND_STABILITY","장기채 안정"],["OIL_STABILITY","유가 안정"],["LIQUIDITY_SUPPLY","유동성 공급"],["AI_CAPEX_SUPPORT","AI 기업 투자속도·정부지원"],["POWER_BITCOIN_NATIONAL_SECURITY","전력·비트코인 채굴·국가안보"],["INVESTMENT_LINK","투자 연결"]];'+
'var DESC={VRT:"전력·냉각 | 데이터센터 전력·열관리 인프라",AVGO:"반도체·AI 네트워크 | AI 가속기·네트워크 반도체",LS:"전력기기 | 전력망 자동화·배전/송전 장비",HD:"전력기기 | 변압기·고압 전력설비"};'+
'function esc(v){return String(v==null?"":v).replace(/[&<>\"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]})}'+
'function n(v){var x=Number(v);return Number.isFinite(x)?x:null}'+
'function fmt(v,c){var x=n(v);if(x==null)return "--";if(c==="KRW")return Math.round(x).toLocaleString()+"원";if(c==="USD")return "$"+x.toLocaleString(undefined,{maximumFractionDigits:2});return x.toLocaleString(undefined,{maximumFractionDigits:2})}'+
'async function j(u){try{var r=await fetch(u+(u.indexOf("?")>=0?"&":"?")+"t="+Date.now(),{cache:"no-store"});if(r.status===401){location.href="/login";return null}if(!r.ok)return null;return await r.json()}catch(e){return null}}'+
'function mount(){if(document.getElementById("gnInvestmentLink"))return;var wrap=document.querySelector(".wrap");if(!wrap)return;var box=document.createElement("section");box.id="gnInvestmentLink";box.innerHTML="<div class=\"gnHead\"><div><div class=\"gnTitle\">투자 연결판 · 정책 → 돈의 이동 → 자산군 → 가격</div><div class=\"gnStage\" id=\"gnLinkStage\">WATCH</div><div class=\"gnLine\" id=\"gnLinkLine\">시장 전달 확인 중</div></div><div class=\"gnRev\">2026-09-21 REV1<br>SAVE → Reuters/공시 역검증</div></div><div class=\"gnGrid\" id=\"gnAssetFocus\"></div><div class=\"gnPolicy\" id=\"gnPolicyRows\"></div><div class=\"gnRisk\"><b>주식 동반하락 조건</b><div class=\"gnRiskText\" id=\"gnJointRisk\">금리·달러·유가·시장폭 조합 확인 중</div></div>";var top=wrap.querySelector(".top");if(top&&top.parentNode)top.parentNode.insertBefore(box,top.nextSibling);else wrap.insertBefore(box,wrap.firstChild)}'+
'function stageOf(bp){var m=bp&&bp.market||{},mc=bp&&bp.macro||{},rates=n(mc.rates_score),liq=n(mc.liquidity_score),usd=n(mc.usd_fx_score),comm=n(mc.commodities_score),bread=n(m.spot_breadth100),btc=n(m.btc_taker_ratio),eth=n(m.eth_taker_ratio);if(bread!=null&&bread<=1)bread*=100;var s="WATCH",line="정책 신호보다 실제 시장 전달을 먼저 확인";if(rates!=null&&liq!=null&&rates>=55&&liq>=55&&((usd!=null&&usd>=55)||(comm!=null&&comm>=55))){s="READY";line="금리·유동성 개선 확인 · 자산군 자금 이동 대기"}if(s==="READY"&&bread!=null&&bread>=55&&btc!=null&&eth!=null&&btc>=1&&eth>=1){s="ARMED";line="현물수급·시장폭 확산 확인 · 실행 조건 검증"}return {stage:s,line:line,rates:rates,liq:liq,usd:usd,comm:comm,bread:bread}}'+
'function nearest(items,currency){var a=(items||[]).filter(function(x){return x&&x.currency===currency&&n(x.price)!=null&&Array.isArray(x.first)}).map(function(x){var p=n(x.price),lo=n(x.first[0]),hi=n(x.first[1]),d=(p>=lo&&p<=hi)?0:(p<lo?(lo-p)/Math.max(p,1):(p-hi)/Math.max(p,1));return {x:x,d:Math.abs(d)}}).sort(function(a,b){return a.d-b.d});return a.length?a[0].x:null}'+
'function cryptoPick(rows){var block={ONT:1,XMR:1};var a=(Array.isArray(rows)?rows:[]).filter(function(x){var c=String(x.coin||x.symbol||"").toUpperCase();return c&&!block[c]&&n(x.krw_price||x.price)!=null}).sort(function(a,b){var ra=n(a.rank),rb=n(b.rank);if(ra!=null||rb!=null)return (ra==null?999:ra)-(rb==null?999:rb);return (n(b.score)||0)-(n(a.score)||0)});return a[0]||null}'+
'function goldPick(m){if(!m)return null;var list=Array.isArray(m.items)?m.items:(Array.isArray(m)?m:[]);return list.find(function(x){return /GC|GOLD|금/i.test(String(x.symbol||x.name||""))})||list[0]||null}'+
'function card(label,name,meta,price){return "<div class=\"gnCard\"><div class=\"gnLabel\">"+esc(label)+"</div><div class=\"gnValue\">"+esc(name||"데이터 대기")+"</div><div class=\"gnMeta\">"+esc(meta||"검증 전 후보 없음")+(price?" · "+esc(price):"")+"</div></div>"}'+
'function bankLinkHtml(bank){if(!bank)return "";var p=bank.policy||{},t=p.treasury||{},bc=p.bankCapital||{},b=p.bessentBowman||{},benef=Array.isArray(bank.beneficiaries)?bank.beneficiaries:[];var direct=benef.filter(function(x){return x.tier&&x.tier.indexOf("직접")>=0}).map(function(x){return x.ticker}).join(" · ");var second=benef.filter(function(x){return x.tier&&x.tier.indexOf("간접")>=0}).map(function(x){return x.ticker}).join(" · ");return "<div class=\"gnPolicyDetail\"><b>Bessent × Bowman 연결</b><br>"+esc((bank.path||[]).join(" → "))+"<br>직접 수혜 감시: "+esc(direct||"JPM · C · BAC · GS · MS")+" · 2차 연결: "+esc(second||"BLK")+"<br>Q3 순차입 $"+esc(t.q3NetBorrowingB||"--")+"B · Q4 $"+esc(t.q4NetBorrowingB||"--")+"B · TGA 9월말 $"+esc(t.endSepTgaTargetB||"--")+"B → 12월말 $"+esc(t.endDecTgaTargetB||"--")+"B<br>eSLR: "+esc(bc.eslr||"확인중")+"<br>다음 Treasury: "+esc(t.nextFinancingEstimate||"--")+" / "+esc(t.nextQuarterlyRefunding||"--")+"<br><span style=\"opacity:.8\">"+esc(b.caveat||"국채발행만으로 수혜 확정하지 않음")+"</span></div>"}function renderPolicy(alerts,bank){var rows=Array.isArray(alerts)?alerts:[],row=rows.find(function(x){return x.level==="큰그림 정책"}),payload=null;try{payload=row?JSON.parse(row.message):null}catch(e){}var axes=new Set(Array.isArray(payload&&payload.axes)?payload.axes:[]),providers=Array.isArray(payload&&payload.providers)?payload.providers:[],details=providers.map(function(p){return p&&p.summary}).filter(Boolean);var host=document.getElementById("gnPolicyRows");if(!host)return;host.innerHTML=HEADS.map(function(h){var body=axes.has(h[0])&&details.length?"<div class=\"gnPolicyDetail\">"+details.map(esc).join("<br>")+"</div>":"";if(h[0]==="INVESTMENT_LINK")body+=bankLinkHtml(bank);return "<div class=\"gnPolicyRow\"><b>"+h[1]+"</b>"+body+"</div>"}).join("")}'+
'function renderRisk(s){var bad=[];if(s.rates!=null&&s.rates<45)bad.push("장기금리 부담");if(s.liq!=null&&s.liq<45)bad.push("유동성 약화");if(s.usd!=null&&s.usd<45)bad.push("달러/환율 부담");if(s.comm!=null&&s.comm<45)bad.push("유가·원자재 부담");if(s.bread!=null&&s.bread<45)bad.push("시장폭 약화");var el=document.getElementById("gnJointRisk");if(!el)return;el.textContent=bad.length>=3?"동반하락 조합 강화: "+bad.join(" · "):bad.length?("현재 경고 "+bad.length+"개: "+bad.join(" · ")+" · 3개 이상 동시 충족 시 신규 주식 진입 보수적"): "현재 동반하락 조합 미탐지"}'+
'async function load(){mount();var r=await Promise.all([j("/api/big-picture"),j("/api/risk-buy-fx"),j("/api/latest"),j("/api/metals/live"),j("/api/alerts"),j("/api/bank-capacity-treasury")]),bp=r[0]||{},risk=r[1]||{},latest=r[2]||[],metals=r[3]||{},alerts=r[4]||[],bank=r[5]||null;var s=stageOf(bp),se=document.getElementById("gnLinkStage"),sl=document.getElementById("gnLinkLine");if(se)se.textContent=s.stage;if(sl)sl.textContent=s.line;renderRisk(s);renderPolicy(alerts,bank);var us=nearest(risk.items,"USD"),kr=nearest(risk.items,"KRW"),cp=cryptoPick(latest),gp=goldPick(metals);var focus=document.getElementById("gnAssetFocus");if(focus){var usMeta=us?(DESC[us.key]||"미국주식 감시")+" · 1차구간 "+fmt(us.first&&us.first[0],"USD")+"~"+fmt(us.first&&us.first[1],"USD"):"실제 가격·자금흐름 검증 전";var krMeta=kr?(DESC[kr.key]||"국내주식 감시")+" · 1차구간 "+fmt(kr.first&&kr.first[0],"KRW")+"~"+fmt(kr.first&&kr.first[1],"KRW"):"실제 가격·자금흐름 검증 전";var cName=cp?String(cp.coin||cp.symbol||"").toUpperCase():"";var cPrice=cp?fmt(cp.krw_price||cp.price,"KRW"):"";var gName=gp?String(gp.name||gp.symbol||"Gold"):"Gold";var gPrice=gp?fmt(gp.price||gp.last,"USD"):"";focus.innerHTML=card("미국주식 1개",us&&us.name,usMeta,us&&fmt(us.price,"USD"))+card("한국주식 1개",kr&&kr.name,krMeta,kr&&fmt(kr.price,"KRW"))+card("크립토 1개",cName,cp?"현재 GN 순위/점수 선두 · WATCH→READY→ARMED 적용":"실시간 후보 없음",cPrice)+card("금/안전자산 1개",gName,"안전자산 가격 확인 · 위험신호와 함께 판단",gPrice)}}'+
'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){mount();load()});else{mount();load()}setInterval(load,60000);'+
'})();</script>';

function patchHtml(html){
  if(typeof html!=="string"||!html.includes("GN PIVOT")||html.includes("gn-investment-link-v1"))return html;
  var out=html;
  if(out.includes("</head>"))out=out.replace("</head>",STYLE+"</head>");
  return out.replace("</body>",SCRIPT+"</body>");
}

function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.use((req,res,next)=>{
    const send=res.send.bind(res);
    res.send=function(body){return send(patchHtml(body));};
    next();
  });
  return app;
}

Object.assign(wrappedExpress,previousExpress);
require.cache[expressPath].exports=wrappedExpress;
