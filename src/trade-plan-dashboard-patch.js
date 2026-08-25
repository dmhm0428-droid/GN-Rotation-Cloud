"use strict";

// GN fixed sell-plan dashboard layer.
// User reports an actual buy; the investment assistant stores exact sell prices
// in gn_trade_plans. This module only displays the plan. It never sends orders.

const {createClient}=require("@supabase/supabase-js");
const expressPath=require.resolve("express");
const originalExpress=require("express");

const URL=process.env.SUPABASE_URL;
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const db=URL&&KEY?createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}}):null;

async function loadTradePlans(){
  if(!db)return {available:false,reason:"Supabase env missing",items:[]};
  const {data,error}=await db.from("gn_trade_plans")
    .select("id,symbol,market,entry_price,quantity,tp1_price,tp1_fraction,tp2_price,tp2_fraction,tp3_price,tp3_fraction,invalidation_price,action,status,note,updated_at")
    .eq("status","ACTIVE")
    .order("updated_at",{ascending:false});
  if(error)throw error;
  return {available:true,items:data||[],ts:new Date().toISOString(),note:"표시 전용 · 거래소에 직접 예약매도 입력"};
}

const PLAN_PANEL_HTML=`<h2>내 매도가 · 예약매도</h2>
<div class="muted" style="margin-bottom:8px">실제 매수한 종목만 표시 · 값이 바뀌면 변경 사유를 별도 검증</div>
<div class="top3" id="tradePlanBox"><div class="empty">매도 계획 불러오는 중…</div></div>`;

const PLAN_SCRIPT=`<script>
(function(){
  function esc(s){return String(s==null?'':s).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]||c;});}
  function money(x,market){
    if(x==null||x==='')return '-';
    var n=Number(x);if(!Number.isFinite(n))return esc(x);
    if(String(market||'KRW').toUpperCase()==='KRW')return n.toLocaleString('ko-KR')+'원';
    return '$'+n.toLocaleString(undefined,{maximumFractionDigits:6});
  }
  function pct(x){var n=Number(x);return Number.isFinite(n)?Math.round(n*100)+'%':'';}
  async function loadTradePlans(){
    var box=document.getElementById('tradePlanBox');if(!box)return;
    try{
      var r=await fetch('/api/trade-plans');if(!r.ok)throw new Error('HTTP '+r.status);
      var d=await r.json();
      if(!d.available){box.innerHTML='<div class="empty">매도 계획 데이터 확인 · '+esc(d.reason||'연결 안 됨')+'</div>';return;}
      var items=d.items||[];
      if(!items.length){box.innerHTML='<div class="empty">실제 매수 종목을 알려주면 여기에 매도가를 고정 표시합니다.</div>';return;}
      box.innerHTML=items.map(function(x){
        var tps=[];
        if(x.tp1_price!=null)tps.push('1차 '+money(x.tp1_price,x.market)+(x.tp1_fraction!=null?' · '+pct(x.tp1_fraction):''));
        if(x.tp2_price!=null)tps.push('2차 '+money(x.tp2_price,x.market)+(x.tp2_fraction!=null?' · '+pct(x.tp2_fraction):''));
        if(x.tp3_price!=null)tps.push('3차 '+money(x.tp3_price,x.market)+(x.tp3_fraction!=null?' · '+pct(x.tp3_fraction):''));
        var invalid=x.invalidation_price!=null?'무효화 '+money(x.invalidation_price,x.market):'';
        var meta=['매수 '+money(x.entry_price,x.market)].concat(tps).concat(invalid?[invalid]:[]).join(' · ');
        return '<div class="pick"><div class="rank">'+esc(String(x.symbol||'').slice(0,3))+'</div><div><div class="pickName">'+esc(x.symbol)+'</div><div class="pickMeta">'+esc(meta)+'</div>'+(x.note?'<div class="pickMeta">'+esc(x.note)+'</div>':'')+'</div><div class="pickAction good">'+esc(x.action||'예약매도')+'</div></div>';
      }).join('');
    }catch(e){box.innerHTML='<div class="empty bad">매도 계획 오류 · '+esc(e.message)+'</div>';}
  }
  loadTradePlans();setInterval(loadTradePlans,60000);
})();
</script>`;

function inject(html){
  if(typeof html!=="string"||!html.includes("GN PIVOT"))return html;
  if(!html.includes('id="tradePlanBox"')){
    const anchor='<h2>자동매도 보호 · Rescue</h2>';
    const fallback='<h2>지금 볼 TOP3</h2>';
    if(html.includes(anchor))html=html.replace(anchor,PLAN_PANEL_HTML+anchor);
    else if(html.includes(fallback))html=html.replace(fallback,PLAN_PANEL_HTML+fallback);
    else html=html.replace('</body>',PLAN_PANEL_HTML+'</body>');
  }
  if(!html.includes('loadTradePlans();setInterval'))html=html.replace('</body>',PLAN_SCRIPT+'</body>');
  return html;
}

function wrappedExpress(...args){
  const app=originalExpress(...args);
  app.use((req,res,next)=>{
    if(req.path==='/api/trade-plans'){
      loadTradePlans().then(x=>res.json(x)).catch(e=>res.status(500).json({available:false,error:String(e?.message||e),items:[]}));
      return;
    }
    const send=res.send.bind(res);
    res.send=function(body){return send(inject(body));};
    next();
  });
  return app;
}
Object.assign(wrappedExpress,originalExpress);
require.cache[expressPath].exports=wrappedExpress;
