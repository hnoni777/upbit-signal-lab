'use strict';
const API='https://upbit-signal-proxy.parkdam6.workers.dev/v1';
let markets=[],tickers=[];
let previousPrices=new Map(),alertsOn=false,lastAlertAt=new Map(),alertHistory=[];
let loading=false;
let watch=new Set(JSON.parse(localStorage.getItem('usl-watch')||'["KRW-SHIB"]'));
const $=id=>document.getElementById(id);
const fmt=(n,d=0)=>Number(n).toLocaleString('ko-KR',{maximumFractionDigits:d});
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function get(path){const r=await fetch(API+path,{headers:{accept:'application/json'}});if(!r.ok)throw Error('API HTTP '+r.status);return r.json()}
function score(t){const change=t.signed_change_rate*100,vol=t.acc_trade_price_24h;return Math.min(100,Math.max(0,Math.round(25+change*3+Math.log10(Math.max(vol,1)/1e8)*12)))}
async function load(){
 if(loading)return;
 loading=true;
 try{
  $('status').textContent='업비트 연결 중';
  if(!markets.length)markets=(await get('/market/all?isDetails=false')).filter(m=>m.market.startsWith('KRW-'));
  const all=[];
  for(let i=0;i<markets.length;i+=80){const batch=markets.slice(i,i+80);all.push(...await get('/ticker?markets='+encodeURIComponent(batch.map(m=>m.market).join(','))))}
  tickers=all.map(t=>({...t,meta:markets.find(m=>m.market===t.market)}));
  $('count').textContent=fmt(tickers.length);
  $('updated').textContent=new Date().toLocaleTimeString('ko-KR');
  $('status').textContent='시세 연결됨';render();checkAlerts();
 }catch(e){$('status').textContent='조회 실패';$('coins').innerHTML='<tr><td colspan="5">조회 실패: '+esc(e.message)+' · 새로고침을 눌러 주세요.</td></tr>'}
 finally{loading=false}
}
function render(){
 const q=$('search').value.toLowerCase(),order=$('sort').value;
 let list=tickers.filter(t=>(t.market+' '+(t.meta?.korean_name||'')).toLowerCase().includes(q));
 list.sort((a,b)=>order==='volume'?b.acc_trade_price_24h-a.acc_trade_price_24h:order==='change'?b.signed_change_rate-a.signed_change_rate:score(b)-score(a));
 $('candidates').textContent=fmt(tickers.filter(t=>score(t)>=75).length);
 $('coins').innerHTML=list.map(t=>'<tr><td><b>'+esc(t.meta?.korean_name||t.market)+'</b><br><span class="muted">'+esc(t.market)+'</span></td><td class="'+(t.signed_change_rate>=0?'positive':'negative')+'">'+(t.signed_change_rate>=0?'+':'')+(t.signed_change_rate*100).toFixed(2)+'%</td><td>'+fmt(t.acc_trade_price_24h/1e8,1)+'억</td><td>'+score(t)+'점</td><td><button class="star" data-market="'+esc(t.market)+'">'+(watch.has(t.market)?'★':'☆')+'</button></td></tr>').join('')||'<tr><td colspan="5">일치하는 종목이 없습니다.</td></tr>';
 $('watchlist').innerHTML=[...watch].map(m=>{const t=tickers.find(x=>x.market===m);return '<div class="watchitem"><span>'+esc(t?.meta?.korean_name||m)+' ('+esc(m)+')</span><span>'+(t?fmt(t.trade_price,8)+'원':'시세 대기')+'</span></div>'}).join('')||'<p>관심 종목이 없습니다.</p>';
 const shib=tickers.find(t=>t.market==='KRW-SHIB');
 $('shibStatus').textContent=shib?'현재 '+fmt(shib.trade_price,8)+'원 · '+(shib.trade_price>=0.00727?'본전 기준 이상':'본전 기준 미만')+' (수수료 제외)':'시바이누 시세 없음';
}

// Browser-only watchlist alerts: no push subscription or background service.
const threshold=$('alertThreshold');
threshold.value=localStorage.getItem('usl-alert-threshold')||'2';
threshold.onchange=()=>localStorage.setItem('usl-alert-threshold',threshold.value);
$('enableAlerts').onclick=async()=>{
 if(alertsOn){alertsOn=false;$('enableAlerts').textContent='알림 켜기';$('alertState').textContent='알림 꺼짐';return}
 alertsOn=true;
 if('Notification' in window && Notification.permission==='default'){
  try{await Notification.requestPermission()}catch(e){}
 }
 $('enableAlerts').textContent='알림 끄기';
 $('alertState').textContent=('Notification' in window && Notification.permission==='granted')?'화면 알림 + 브라우저 알림 활성':'화면 알림 활성 (브라우저 알림 권한 없음)';
};
function checkAlerts(){
 const now=Date.now(),limit=Number(threshold.value);
 for(const t of tickers){
  const old=previousPrices.get(t.market);
  if(alertsOn&&watch.has(t.market)&&old>0){
   const delta=(t.trade_price/old-1)*100;
   if(delta>=limit&&now-(lastAlertAt.get(t.market)||0)>10*60*1000){
    lastAlertAt.set(t.market,now);
    const name=t.meta?.korean_name||t.market;
    const msg=name+' '+delta.toFixed(2)+'% 상승 (직전 조회 대비)';
    alertHistory.unshift({msg,time:new Date(now).toLocaleTimeString('ko-KR')});
    alertHistory=alertHistory.slice(0,15);
    $('alertLog').innerHTML=alertHistory.map(a=>'<div class="alertentry">'+esc(a.time+' · '+a.msg)+'</div>').join('');
    if('Notification' in window&&Notification.permission==='granted'){
     try{new Notification('UPBIT SIGNAL LAB',{body:msg,tag:'usl-'+t.market})}catch(e){}
    }
   }
  }
  previousPrices.set(t.market,t.trade_price);
 }
}

$('coins').addEventListener('click',e=>{const b=e.target.closest('[data-market]');if(!b)return;const m=b.dataset.market;watch.has(m)?watch.delete(m):watch.add(m);localStorage.setItem('usl-watch',JSON.stringify([...watch]));render()});
$('search').oninput=render;$('sort').onchange=render;$('refresh').onclick=load;
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id===b.dataset.tab))});
// Daily-candle research, with explicit out-of-sample time split.
$('runBacktest').onclick=async()=>{
 const out=$('backtestResult'),btn=$('runBacktest');
 btn.disabled=true;
 out.textContent='최근 12개월 일봉 조회 중 (최대 2회 요청)...';
 try{
  const market=$('backtestCoin').value,target=Number($('target').value),multiple=Number($('volumeMultiple').value);
  // Exclude the current unfinished KST trading day by paging from today's 00:00 KST.
  const now=new Date(),todayKst=new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
  const cutoff=new Date(todayKst+'T00:00:00+09:00');
  const first=await get('/candles/days?market='+encodeURIComponent(market)+'&count=200&to='+encodeURIComponent(cutoff.toISOString()));
  if(!Array.isArray(first)||!first.length)throw Error('일봉 응답이 비어 있습니다.');
  const oldest=first[first.length-1].candle_date_time_utc;
  const second=await get('/candles/days?market='+encodeURIComponent(market)+'&count=200&to='+encodeURIComponent(oldest+'Z'));
  if(!Array.isArray(second))throw Error('두 번째 일봉 응답이 올바르지 않습니다.');
  const unique=new Map([...first,...second].map(c=>[c.candle_date_time_utc,c]));
  let candles=[...unique.values()].filter(c=>new Date(c.candle_date_time_utc+'Z')<cutoff).sort((a,b)=>a.candle_date_time_utc.localeCompare(b.candle_date_time_utc));
  const yearAgo=new Date(cutoff);yearAgo.setUTCDate(yearAgo.getUTCDate()-365);
  candles=candles.filter(c=>new Date(c.candle_date_time_utc+'Z')>=yearAgo);
  if(candles.length<80)throw Error('분석 가능한 일봉이 80개 미만입니다. 상장 기간 또는 중계 서버의 /candles/days 및 to 지원을 확인하세요.');
  const trainEnd=Math.floor(candles.length*.7),lookback=20,horizon=7;
  function measure(from,to){
   let n=0,signals=0,hits=0,events=0;
   for(let i=Math.max(lookback,from);i<Math.min(to,candles.length-horizon);i++){
    const prev=candles.slice(i-lookback,i),recent=prev.slice(-7);
    const avg=recent.reduce((s,c)=>s+c.candle_acc_trade_volume,0)/recent.length;
    const signal=candles[i].candle_acc_trade_volume>avg*multiple&&candles[i].trade_price>Math.max(...prev.map(c=>c.trade_price));
    const futureHigh=Math.max(...candles.slice(i+1,i+1+horizon).map(c=>c.high_price));
    const event=futureHigh>=candles[i].trade_price*(1+target);
    n++;if(event)events++;if(signal){signals++;if(event)hits++}
   }
   return {n,signals,hits,events};
  }
  // Prevent train outcomes from looking into the holdout period.
  const train=measure(lookback,trainEnd-horizon);
  const test=measure(trainEnd,candles.length-horizon);
  const pct=(a,b)=>b?((100*a/b).toFixed(1)+'%'):'표본 없음';
  const block=(label,x)=>'<h3>'+label+'</h3><p>평가 '+x.n+'일 · 신호 '+x.signals+'건 · 적중 '+x.hits+'건 · 급등 사건 '+x.events+'건</p><p>정밀도 '+pct(x.hits,x.signals)+' · 재현율 '+pct(x.hits,x.events)+' · 무신호 포함 급등 빈도 '+pct(x.events,x.n)+'</p>';
  out.innerHTML='<b>'+esc(market)+' · 일봉 '+candles.length+'개 · '+esc(candles[0].candle_date_time_kst.slice(0,10))+' ~ '+esc(candles[candles.length-1].candle_date_time_kst.slice(0,10))+'</b>'+block('탐색 구간 (앞 70%)',train)+block('시간순 별도 검증 (뒤 30%)',test)+'<p>거래량 '+multiple+'배 / 다음 7일 +'+(target*100).toFixed(0)+'% 기준. 일봉 종가 확정 뒤에야 신호가 확인됩니다. 검증 구간의 표본이 적으면 통계적으로 신뢰하기 어렵습니다.</p>';
 }catch(e){out.textContent='12개월 검증 실패: '+e.message+' (중계 서버에 일봉·to 경로를 추가해야 할 수 있습니다.)'}
 finally{btn.disabled=false}
};
load();setInterval(()=>{if(!document.hidden)load()},60000);
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
