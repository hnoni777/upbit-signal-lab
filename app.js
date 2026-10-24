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
 }catch(e){$('status').textContent='조회 실패';$('scanProgress').textContent='시세 조회 실패: '+e.message}
 finally{loading=false}
}
function render(){
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

$('refresh').onclick=load;
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id===b.dataset.tab))});

let scanBusy=false;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const STABLE_SYMBOLS=new Set(['USDT','USDC','DAI','TUSD','USDD','FDUSD','USDP','PYUSD','EURC','BUSD','USD1','RLUSD']);
function patternFeatures(days,i){
 if(i<21)return null;
 const last=days[i],prev=days.slice(i-20,i),recent=days.slice(i-5,i);
 const avg=prev.reduce((s,c)=>s+c.candle_acc_trade_price,0)/20;
 const volume=last.candle_acc_trade_price/Math.max(avg,1);
 const range20=(Math.max(...prev.map(c=>c.high_price))-Math.min(...prev.map(c=>c.low_price)))/Math.max(prev.at(-1).trade_price,1e-12);
 const range5=(Math.max(...recent.map(c=>c.high_price))-Math.min(...recent.map(c=>c.low_price)))/Math.max(recent.at(-1).trade_price,1e-12);
 const compression=range5/Math.max(range20,1e-9);
 const proximity=last.trade_price/Math.max(...prev.map(c=>c.high_price));
 const dayChange=(last.trade_price/Math.max(last.prev_closing_price,1e-12)-1)*100;
 const volumeOK=volume>=1.5&&volume<=5;
 const compressed=compression<=0.65;
 const nearHigh=proximity>=0.95&&proximity<=1.015;
 const notChasing=dayChange>=-2&&dayChange<=4;
 return {volume,compression,proximity,dayChange,volumeOK,compressed,nearHigh,notChasing,count:[volumeOK,compressed,nearHigh,notChasing].filter(Boolean).length};
}
function patternEvidence(candles,ticker){
 if(!Array.isArray(candles)||candles.length<90)return null;
 const kstDate=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const days=candles.filter(c=>c.candle_date_time_kst.slice(0,10)<kstDate).sort((a,b)=>a.candle_date_time_kst.localeCompare(b.candle_date_time_kst));
 if(days.length<85)return null;
 const f=patternFeatures(days,days.length-1);
 if(!f||!f.volumeOK||f.count<3||ticker.signed_change_rate>0.10)return null;
 const reasons=['전일 거래대금 '+f.volume.toFixed(2)+'배 (직전 20일 평균 대비)'];
 if(f.compressed)reasons.push('최근 5일 가격 범위 '+(f.compression*100).toFixed(0)+'% (이전 20일 대비)');
 if(f.nearHigh)reasons.push('20일 최고가 대비 종가 위치 '+(f.proximity*100).toFixed(1)+'%');
 if(f.notChasing)reasons.push('전일 등락 '+f.dayChange.toFixed(2)+'% (급등 추격 일부 제외)');
 // Compare the exact same rule against earlier historical days, without future leakage.
 let signals=0,hits=0,events=0,observations=0;
 for(let i=21;i<days.length-7;i++){
  const h=patternFeatures(days,i);
  if(!h)continue;
  const event=Math.max(...days.slice(i+1,i+8).map(c=>c.high_price))>=days[i].trade_price*1.05;
  observations++;if(event)events++;
  if(h.volumeOK&&h.count>=3){signals++;if(event)hits++}
 }
 return {market:ticker.market,name:ticker.meta?.korean_name||ticker.market,reasons,count:f.count,volRatio:f.volume,price:ticker.trade_price,change:ticker.signed_change_rate*100,date:days.at(-1).candle_date_time_kst.slice(0,10),history:{signals,hits,events,observations},days:days.length};
}

$('scanPatterns').onclick=async()=>{
 if(scanBusy)return;
 if(!tickers.length){$('scanProgress').textContent='먼저 시세 연결을 기다려 주세요.';return}
 scanBusy=true;
 const btn=$('scanPatterns'),progress=$('scanProgress'),out=$('patternCandidates');
 btn.disabled=true;out.innerHTML='<p>후보를 분석하고 있습니다...</p>';
 let failed=0,checked=0;
 const found=[];
 const targets=[...tickers].filter(t=>t.acc_trade_price_24h>0&&!STABLE_SYMBOLS.has(t.market.slice(4))).sort((a,b)=>b.acc_trade_price_24h-a.acc_trade_price_24h).slice(0,30);
 try{
  for(const t of targets){
   progress.textContent='분석 중 '+(++checked)+' / '+targets.length+' · '+t.market;
   try{
    const days=await get('/candles/days?market='+encodeURIComponent(t.market)+'&count=200');
    const evidence=patternEvidence(days,t);
    if(evidence)found.push(evidence);
   }catch(e){failed++}
   if(checked<targets.length)await pause(180);
  }
  found.sort((a,b)=>b.count-a.count||b.volRatio-a.volRatio);
  $('candidates').textContent=String(found.length);
  const pct=(a,b)=>b?(100*a/b).toFixed(1)+'%':'표본 부족';
  out.innerHTML=found.length?found.map(c=>{
   const h=c.history;
   return '<article class="pattern-card"><div class="pattern-head"><b>'+esc(c.name)+' <small>'+esc(c.market)+'</small></b><span>'+c.count+'/4 조건 일치</span></div><p>현재 시세 '+fmt(c.price,8)+'원 · 24시간 '+c.change.toFixed(2)+'%</p><b>선정 근거 (확정 일봉 '+esc(c.date)+')</b><ul>'+c.reasons.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul><b>과거 동일 조건 비교 (최근 '+c.days+'개 일봉)</b><p>과거 신호 '+h.signals+'건 · 이후 7일 내 +5% 도달 '+h.hits+'건 · 관찰 적중률 '+pct(h.hits,h.signals)+' · 전체 일자 기본 급등률 '+pct(h.events,h.observations)+'</p><p>과거 표본은 규칙 설계에 사용된 기간과 겹치므로 독립 검증이 아닙니다. 미래 상승 확률로 해석하면 안 됩니다.</p><button data-add-watch="'+esc(c.market)+'">☆ 관심 종목 등록</button></article>';
  }).join(''):'<p>현재 필수 거래대금 증가 조건을 포함한 전조 후보가 없습니다. 스테이블코인은 제외했습니다.</p>';

  progress.textContent='완료 · '+checked+'종 확인 · '+found.length+'종 후보 · '+failed+'종 조회 실패 · '+new Date().toLocaleTimeString('ko-KR');
 }finally{btn.disabled=false;scanBusy=false}
};
$('patternCandidates').addEventListener('click',e=>{
 const b=e.target.closest('[data-add-watch]');if(!b)return;
 watch.add(b.dataset.addWatch);localStorage.setItem('usl-watch',JSON.stringify([...watch]));render();b.textContent='★ 관심 종목 등록됨';
});

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

// Fixed four-market comparison. Uses the same definition as individual daily research.
$('compareCoins').onclick=async()=>{
 const btn=$('compareCoins'),out=$('comparisonResult');
 btn.disabled=true;
 const symbols=['KRW-BTC','KRW-SHIB','KRW-XRP','KRW-ETH'];
 const target=Number($('target').value),multiple=Number($('volumeMultiple').value);
 const now=new Date(),todayKst=new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
 const cutoff=new Date(todayKst+'T00:00:00+09:00');
 const yearAgo=new Date(cutoff);yearAgo.setUTCDate(yearAgo.getUTCDate()-365);
 const pct=(a,b)=>b?(100*a/b).toFixed(1)+'%':'—';
 async function fetchYear(market){
  const path='/candles/days?market='+encodeURIComponent(market)+'&count=200&to=';
  const first=await get(path+encodeURIComponent(cutoff.toISOString()));
  if(!Array.isArray(first)||!first.length)throw Error('일봉 없음');
  const second=await get(path+encodeURIComponent(first[first.length-1].candle_date_time_utc+'Z'));
  if(!Array.isArray(second))throw Error('추가 일봉 없음');
  const unique=new Map([...first,...second].map(c=>[c.candle_date_time_utc,c]));
  return [...unique.values()].filter(c=>{
   const d=new Date(c.candle_date_time_utc+'Z');
   return d>=yearAgo&&d<cutoff;
  }).sort((a,b)=>a.candle_date_time_utc.localeCompare(b.candle_date_time_utc));
 }
 function evaluate(candles){
  const lookback=20,horizon=7,split=Math.floor(candles.length*.7);
  function section(from,to){
   let days=0,signals=0,hits=0,events=0;
   for(let i=Math.max(lookback,from);i<Math.min(to,candles.length-horizon);i++){
    const prev=candles.slice(i-lookback,i);
    const avg=prev.slice(-7).reduce((s,c)=>s+c.candle_acc_trade_volume,0)/7;
    const signal=candles[i].candle_acc_trade_volume>avg*multiple&&candles[i].trade_price>Math.max(...prev.map(c=>c.trade_price));
    const event=Math.max(...candles.slice(i+1,i+1+horizon).map(c=>c.high_price))>=candles[i].trade_price*(1+target);
    days++;if(event)events++;if(signal){signals++;if(event)hits++}
   }
   return {days,signals,hits,events};
  }
  return {train:section(lookback,split-horizon),test:section(split,candles.length-horizon)};
 }
 try{
  const results=[];
  for(const symbol of symbols){
   out.textContent='12개월 일봉 비교 분석 중... '+symbol+' ('+(results.length+1)+'/4)';
   try{
    const candles=await fetchYear(symbol);
    if(candles.length<80)throw Error('일봉 80개 미만');
    results.push({symbol,days:candles.length,...evaluate(candles)});
   }catch(e){results.push({symbol,error:e.message})}
  }
  const rows=results.map(r=>{
   if(r.error)return '<tr><td>'+esc(r.symbol)+'</td><td colspan="6">조회 실패: '+esc(r.error)+'</td></tr>';
   const t=r.test;
   return '<tr><td>'+esc(r.symbol)+'</td><td>'+r.days+'일</td><td>'+t.signals+'건</td><td>'+t.hits+'건</td><td>'+pct(t.hits,t.signals)+'</td><td>'+pct(t.hits,t.events)+'</td><td>'+pct(t.events,t.days)+'</td></tr>';
  }).join('');
  const totals=results.filter(r=>!r.error).reduce((a,r)=>{
   for(const k of ['days','signals','hits','events'])a[k]+=r.test[k];
   return a;
  },{days:0,signals:0,hits:0,events:0});
  out.innerHTML='<b>4종 비교 · 검증 구간(뒤 30%)</b><p>향후 7일 +'+(target*100).toFixed(0)+'% · 거래량 '+multiple+'배 · 코인별 12개월 자료</p><div class="tablewrap"><table><thead><tr><th>코인</th><th>일봉</th><th>신호</th><th>적중</th><th>정밀도</th><th>재현율</th><th>기본 급등률</th></tr></thead><tbody>'+rows+'</tbody></table></div><p>합산 신호 '+totals.signals+'건 · 적중 '+totals.hits+'건 · 정밀도 '+pct(totals.hits,totals.signals)+' · 기본 급등률 '+pct(totals.events,totals.days)+'</p><p>주의: 같은 날 여러 코인에서 신호가 발생할 수 있어 합산 건수는 독립 표본이 아닙니다. 조건을 비교 결과에 맞춰 조정하면 별도 검증의 의미가 약해집니다. 일봉 종가 확정 후 신호이며 실제 체결 수익률이 아닙니다.</p>';
 }catch(e){out.textContent='비교 검증 실패: '+e.message}
 finally{btn.disabled=false}
};

load();setInterval(()=>{if(!document.hidden)load()},60000);
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
