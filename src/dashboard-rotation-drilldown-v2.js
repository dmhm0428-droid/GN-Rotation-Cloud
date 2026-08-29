"use strict";
const expressPath=require.resolve("express");
const previousExpress=require("express");
const {createClient}=require("@supabase/supabase-js");
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

const REP_FIELDS="ts,asset_class,sector,symbol,venue,rank,total_score,flow_score,relative_strength,technical_score,price,action,data_quality";
const CRYPTO_FIELDS="ts,market,rank,score,status,krw_price,first_detected_price,recommended_entry_low,recommended_entry_high,foreign_support_krw,listing_risk";

async function drilldownLatest(req,res){
  try{
    const [assetsR,stockR,cryptoR]=await Promise.all([
      db.from("gn_latest_asset_representatives").select(REP_FIELDS).order("asset_class",{ascending:true}).order("rank",{ascending:true}),
      db.from("gn_latest_stock_sector_representatives").select(REP_FIELDS).order("sector",{ascending:true}).order("rank",{ascending:true}),
      db.from("gn_pre_pump_snapshots").select(CRYPTO_FIELDS).order("ts",{ascending:false}).limit(24)
    ]);
    res.set("Cache-Control","no-store");
    res.json({
      ts:new Date().toISOString(),
      representatives:assetsR.error?[]:(assetsR.data||[]),
      stockRepresentatives:stockR.error?[]:(stockR.data||[]),
      cryptoCandidates:cryptoR.error?[]:(cryptoR.data||[])
    });
  }catch(e){res.status(500).json({error:String(e?.message||e)});}
}

const CLIENT_JS=String.raw`(()=>{
  const assetFromLabel={"크립토":"CRYPTO","미국주식":"STOCK","금":"GOLD","원자재":"COMMODITY","채권":"BOND","현금":"CASH"};
  const sectorKo={Technology:"기술/AI",Energy:"에너지",Communication:"커뮤니케이션",Consumer_Discretionary:"경기소비재",Consumer_Staples:"필수소비재",Healthcare:"헬스케어",Financials:"금융",Materials:"소재",Industrials:"산업재",Real_Estate:"부동산",Utilities:"유틸리티"};
  const actionKo={LEADER:"선두",WATCH:"관찰",DEFENSIVE:"방어",MAINTENANCE:"검증 대기",ENTRY:"진입",SCOUT:"탐지",WAIT:"대기",NO_CHASE:"추격금지"};
  let detailData=null;
  const num=v=>Number(v);
  const fmt=v=>Number.isFinite(num(v))?num(v).toFixed(1):"--";
  const money=(v,venue)=>{const n=num(v);if(!Number.isFinite(n))return "--";if(venue==="UPBIT"||n>=10000)return Math.round(n).toLocaleString("ko-KR")+"원";return "$"+n.toLocaleString("en-US",{maximumFractionDigits:2});};
  function ensureStyle(){
    if(document.getElementById("gn-rotation-drilldown-style-v2"))return;
    const s=document.createElement("style");s.id="gn-rotation-drilldown-style-v2";
    s.textContent="#moneyRotationSection .rotationRow:not(.rotationHead),#moneyRotationSection .sectorFlow>div{cursor:pointer}#rotationDrilldownV2{margin-top:12px;padding-top:12px;border-top:1px solid #26323d}.gnDDHead{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px}.gnDDTitle{font-size:15px;font-weight:900}.gnDDSub{font-size:10px;color:#8d9aa6;margin-top:2px}.gnDDClose{border:1px solid #34424f;background:#121a21;color:#b7c1cb;border-radius:9px;min-height:36px;padding:6px 10px;cursor:pointer}.gnDDList{display:grid;gap:7px}.gnDDCard{background:#121a21;border:1px solid #26323d;border-radius:11px;padding:10px}.gnDDCard button{width:100%;text-align:left;color:inherit;background:transparent;border:0;padding:0;cursor:pointer}.gnDDTop{display:flex;justify-content:space-between;gap:8px;align-items:baseline}.gnDDTop b{font-size:14px}.gnDDBadge{font-size:10px;color:#f4c85a}.gnDDMeta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 10px;margin-top:7px;font-size:11px;color:#b7c1cb}.gnDDMeta strong{color:#e7edf3}@media(max-width:560px){.gnDDMeta{grid-template-columns:1fr}}";
    document.head.appendChild(s);
  }
  function panel(){
    const base=document.querySelector("#moneyRotationSection .rotationPanel");if(!base)return null;
    let p=document.getElementById("rotationDrilldownV2");if(!p){p=document.createElement("div");p.id="rotationDrilldownV2";p.hidden=true;base.appendChild(p);}return p;
  }
  function clearPanel(){const p=panel();if(p){p.hidden=true;p.replaceChildren();}}
  function addText(parent,tag,text,cls){const el=document.createElement(tag);if(cls)el.className=cls;el.textContent=text;parent.appendChild(el);return el;}
  function addMeta(card,label,value){const wrap=card.querySelector(".gnDDMeta")||(()=>{const d=document.createElement("div");d.className="gnDDMeta";card.appendChild(d);return d;})();const span=document.createElement("span");span.append(label+" ");const strong=document.createElement("strong");strong.textContent=value;span.appendChild(strong);wrap.appendChild(span);}
  function card(title,badge){const c=document.createElement("div");c.className="gnDDCard";const top=document.createElement("div");top.className="gnDDTop";addText(top,"b",title);addText(top,"span",badge||"","gnDDBadge");c.appendChild(top);return c;}
  async function data(){if(detailData)return detailData;const r=await fetch("/api/rotation/drilldown?t="+Date.now(),{cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);detailData=await r.json();setTimeout(()=>{detailData=null;},12000);return detailData;}
  async function rotation(){const r=await fetch("/api/rotation/latest?t="+Date.now(),{cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}
  function header(p,title,sub){const h=document.createElement("div");h.className="gnDDHead";const left=document.createElement("div");addText(left,"div",title,"gnDDTitle");addText(left,"div",sub,"gnDDSub");const close=document.createElement("button");close.type="button";close.className="gnDDClose";close.textContent="닫기";close.addEventListener("click",clearPanel);h.append(left,close);p.appendChild(h);}
  function repCard(r){const c=card(r?String(r.symbol||"대표 자산"):"대표 자산",r?(actionKo[r.action]||r.action||"--"):"데이터 없음");if(r){addMeta(c,"현재가",money(r.price,r.venue));addMeta(c,"종합점수",fmt(r.total_score));addMeta(c,"자금흐름",fmt(r.flow_score));addMeta(c,"상대강도",fmt(r.relative_strength));addMeta(c,"기술점수",fmt(r.technical_score));addMeta(c,"데이터품질",fmt(r.data_quality));}return c;}
  async function showSector(sector){
    const p=panel();if(!p)return;p.hidden=false;p.replaceChildren();header(p,(sectorKo[sector]||sector.replaceAll("_"," "))+" 섹터","섹터 흐름 + 현재 대표 선수");
    const list=document.createElement("div");list.className="gnDDList";p.appendChild(list);
    const [d,rot]=await Promise.all([data(),rotation()]);const r=(d.stockRepresentatives||[]).find(x=>x.sector===sector);const flow=(rot.sectors||[]).find(x=>x.sector===sector);
    if(flow){const c=card("섹터 흐름",flow.flow_stage||"--");addMeta(c,"순위",String(flow.rank??"--"));addMeta(c,"RS 1D",fmt(flow.rs_1d));addMeta(c,"RS 5D",fmt(flow.rs_5d));addMeta(c,"가속",fmt(flow.flow_acceleration));list.appendChild(c);}list.appendChild(repCard(r));
  }
  function uniqueCrypto(rows){const seen=new Set(),out=[];for(const x of rows||[]){const k=x.market||"";if(!k||seen.has(k))continue;seen.add(k);out.push(x);if(out.length>=6)break;}return out;}
  async function showAsset(asset){
    const p=panel();if(!p)return;p.hidden=false;p.replaceChildren();header(p,({CRYPTO:"크립토",STOCK:"미국주식",GOLD:"금",COMMODITY:"원자재",BOND:"채권",CASH:"현금"}[asset]||asset)+" 내부 보기",asset==="STOCK"?"섹터를 누르면 대표 종목 상세까지 표시":"현재 대표 자산과 내부 후보");
    const list=document.createElement("div");list.className="gnDDList";p.appendChild(list);
    const d=await data();
    if(asset==="STOCK"){
      const rot=await rotation();for(const x of (rot.sectors||[]).filter(x=>x.asset_class==="STOCK")){const r=(d.stockRepresentatives||[]).find(y=>y.sector===x.sector);const c=card(sectorKo[x.sector]||x.sector.replaceAll("_"," "),"#"+(x.rank??"--")+" "+(x.flow_stage||""));const btn=document.createElement("button");btn.type="button";while(c.firstChild)btn.appendChild(c.firstChild);c.appendChild(btn);addMeta(c,"대표",r?.symbol||"--");addMeta(c,"현재가",r?money(r.price,r.venue):"--");addMeta(c,"RS 1D",fmt(x.rs_1d));addMeta(c,"가속",fmt(x.flow_acceleration));btn.addEventListener("click",()=>showSector(x.sector));list.appendChild(c);}return;
    }
    const rep=(d.representatives||[]).find(x=>x.asset_class===asset);if(rep)list.appendChild(repCard(rep));
    if(asset==="CRYPTO")for(const x of uniqueCrypto(d.cryptoCandidates)){const c=card(String(x.market||"").replace(/^KRW-/,""),actionKo[x.status]||x.status||"--");addMeta(c,"현재가",money(x.krw_price,"UPBIT"));addMeta(c,"점수",fmt(x.score));addMeta(c,"탐지가",money(x.first_detected_price,"UPBIT"));addMeta(c,"추천진입",num(x.recommended_entry_low)>0?money(x.recommended_entry_low,"UPBIT")+"~"+money(x.recommended_entry_high,"UPBIT"):"승인 대기");addMeta(c,"해외지지",money(x.foreign_support_krw,"UPBIT"));addMeta(c,"상장위험",x.listing_risk||"--");list.appendChild(c);}
    if(!list.children.length)list.appendChild(card("현재 상세 데이터 없음",""));
  }
  function bind(){
    ensureStyle();const root=document.getElementById("moneyRotationSection");if(!root||root.dataset.drilldownV2)return;root.dataset.drilldownV2="1";
    root.addEventListener("click",e=>{const row=e.target.closest(".rotationRow:not(.rotationHead)");if(row&&root.contains(row)){const label=row.querySelector("b")?.textContent?.trim();const asset=assetFromLabel[label];if(asset){showAsset(asset).catch(()=>{});return;}}const sec=e.target.closest(".sectorFlow>div");if(sec&&root.contains(sec)){const label=sec.querySelector("b")?.textContent?.trim();const reverse=Object.fromEntries(Object.entries(sectorKo).map(([k,v])=>[v,k]));const sector=reverse[label]||label;if(sector)showSector(sector).catch(()=>{});}});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind,{once:true});else bind();
})();`;

function clientJs(req,res){res.set("Cache-Control","no-store");res.type("application/javascript; charset=utf-8").send(CLIENT_JS);}
function patchHtml(html){
  if(typeof html!=="string"||!html.includes("<title>GN PIVOT</title>")||html.includes("rotation-drilldown-v2.js"))return html;
  return html.replace("</body>",'<script src="/assets/rotation-drilldown-v2.js" defer></script></body>');
}
function wrappedExpress(...args){
  const app=previousExpress(...args);
  app.get("/api/rotation/drilldown",drilldownLatest);
  app.get("/assets/rotation-drilldown-v2.js",clientJs);
  app.use((req,res,next)=>{const send=res.send.bind(res);res.send=function(body){return send(patchHtml(body))};next()});
  return app;
}
Object.assign(wrappedExpress,previousExpress);require.cache[expressPath].exports=wrappedExpress;
