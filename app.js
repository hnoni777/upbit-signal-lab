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

/* Historical precursor research: 15-minute candles, chronological train/holdout,
   actual +3% / 60-minute events, non-event controls, and nearest-pattern comparison.
   Results are descriptive, never probabilities of future returns. */
const HIST_INTERVAL=15,HIST_PAGES=10,HIST_MARKETS=18,HORIZON=4,TARGET_GAIN=.03;
const SCAN_MAX_24H_GAIN=8, SCAN_MAX_STALE_MS=45*60000;
const MIN_NEIGHBORS=15, MIN_VALIDATION_SIGNALS=8;
const featureNames=['1시간 수익률','3시간 수익률','6시간 수익률','24시간 수익률','1시간 거래대금 배수','3시간 거래대금 배수','6시간 변동폭','24시간 고점 근접도','종가 위치'];
function pctReturn(a,b){return 100*(a/Math.max(b,1e-12)-1)}
function extractFeatures(c,i){
 if(i<96)return null;
 // Upbit can omit candles for no-trade intervals: do not treat gaps as 15-minute bars.
 if(Date.parse(c[i].candle_date_time_utc+'Z')-Date.parse(c[i-96].candle_date_time_utc+'Z')!==96*HIST_INTERVAL*60000)return null;
 const cur=c[i],p=c.slice(i-96,i);
 const average=(xs)=>xs.reduce((s,x)=>s+x.candle_acc_trade_price,0)/Math.max(xs.length,1);
 const range=(xs)=>(Math.max(...xs.map(x=>x.high_price))-Math.min(...xs.map(x=>x.low_price)))/Math.max(cur.trade_price,1e-12)*100;
 const v1=average(p.slice(-4))/Math.max(average(p.slice(-96)),1);
 const v3=average(p.slice(-12))/Math.max(average(p.slice(-96)),1);
 const vals=[
  pctReturn(cur.trade_price,c[i-4].trade_price),
  pctReturn(cur.trade_price,c[i-12].trade_price),
  pctReturn(cur.trade_price,c[i-24].trade_price),
  pctReturn(cur.trade_price,c[i-96].trade_price),
  v1,v3,range(p.slice(-24)),cur.trade_price/Math.max(...p.map(x=>x.high_price)),
  (cur.trade_price-cur.low_price)/Math.max(cur.high_price-cur.low_price,1e-12)
 ];
 if(vals.some(x=>!Number.isFinite(x)))return null;
 return vals;
}
const scales=[2,4,7,15,2,2,5,.06,.5];
function distance(a,b){return a.reduce((s,v,j)=>s+Math.min(16,Math.pow((v-b[j])/scales[j],2)),0)/a.length}
function neighbors(v,samples,k=MIN_NEIGHBORS){
 return samples.map(x=>({d:distance(v,x.f),event:x.event})).sort((a,b)=>a.d-b.d).slice(0,k);
}
function outcome(c,i){
 if(i+HORIZON>=c.length)return null;
 const start=Date.parse(c[i].candle_date_time_utc+'Z'),finish=Date.parse(c[i+HORIZON].candle_date_time_utc+'Z');
 if(finish-start!==HORIZON*HIST_INTERVAL*60000)return null;
 return Math.max(...c.slice(i+1,i+HORIZON+1).map(x=>x.high_price))>=c[i].trade_price*(1+TARGET_GAIN);
}
async function fetchHistory(market,progress){
 const seen=new Map();let to='';
 for(let page=0;page<HIST_PAGES;page++){
  progress(page+1,HIST_PAGES);
  const path='/candles/minutes/15?market='+encodeURIComponent(market)+'&count=200'+(to?'&to='+encodeURIComponent(to):'');
  const batch=await get(path);
  if(!Array.isArray(batch)||!batch.length)break;
  for(const x of batch)seen.set(x.candle_date_time_utc,x);
  const oldest=batch.at(-1).candle_date_time_utc;
  if(batch.length<200||oldest+'Z'===to)break;
  // The API 'to' cursor is exclusive; keep it in UTC.
  to=oldest+'Z';
  await pause(125);
 }
 const now=Math.floor(Date.now()/(HIST_INTERVAL*60000))*HIST_INTERVAL*60000;
 return [...seen.values()].filter(x=>Date.parse(x.candle_date_time_utc+'Z')<now).sort((a,b)=>a.candle_date_time_utc.localeCompare(b.candle_date_time_utc));
}
function historicalSamples(c){
 const train=[],test=[];const split=Math.floor(c.length*.7);
 for(let i=96;i<c.length-HORIZON;i+=4){
  const f=extractFeatures(c,i),event=outcome(c,i);
  if(!f||event===null)continue;
  const sample={f,event,market:c[i].market,ts:Date.parse(c[i].candle_date_time_utc+'Z')};
  if(i+HORIZON<split)train.push(sample);
  else if(i>=split)test.push(sample);
 }
 return {train,test};
}
function earlyStage(f){
 // Broad pre-breakout eligibility; a later independent holdout decides whether signals are trustworthy.
 // Hard exclusions prevent chasing coins already in a major move.
 return f[0]>=-2&&f[0]<=2&&f[1]>=-4&&f[1]<=4&&f[2]>=-7&&f[2]<=7&&
  f[3]>=-12&&f[3]<=8&&f[4]>=.65&&f[5]>=.60&&f[6]<=16&&
  f[7]>=.65&&f[7]<=1.025&&f[8]>=.35;
}
function evaluateModel(train,test){
 const training=train.filter(x=>earlyStage(x.f));
 const eligible=test.filter(x=>earlyStage(x.f));
 const trainBase=training.length?training.filter(x=>x.event).length/training.length:0;
 const testBase=eligible.length?eligible.filter(x=>x.event).length/eligible.length:0;
 let selected=0,hits=0;
 // Fixed before holdout evaluation. Never tune against test labels.
 const cutoff=Math.max(.20,trainBase*1.35);
 for(const x of eligible){
  const n=neighbors(x.f,training,MIN_NEIGHBORS);
  if(n.length<MIN_NEIGHBORS)continue;
  const rate=n.filter(y=>y.event).length/n.length;
  if(rate>=cutoff){selected++;if(x.event)hits++}
 }
 return {total:eligible.length,events:eligible.filter(x=>x.event).length,
  selected,hits,baseline:testBase,trainBase,cutoff,precision:selected?hits/selected:0,trainEligible:training.length};
}
function candidateAssessment(t,history,train,validation){
 const f=extractFeatures(history,history.length-1);
 if(!f)return null;
 const lastTs=Date.parse(history.at(-1).candle_date_time_utc+'Z');
 const fresh=Date.now()-lastTs<=SCAN_MAX_STALE_MS;
 const notAlreadyUp=t.signed_change_rate*100<=SCAN_MAX_24H_GAIN;
 const pre=earlyStage(f)&&fresh&&notAlreadyUp;
 const n=neighbors(f,train.filter(x=>earlyStage(x.f)),MIN_NEIGHBORS);
 if(n.length<MIN_NEIGHBORS)return {market:t.market,name:t.meta?.korean_name||t.market,price:t.trade_price,change:t.signed_change_rate*100,f,rate:0,hits:0,neighbors:n.length,category:'risk',reason:'급등 이전 조건에 맞는 과거 비교 표본 부족',date:history.at(-1).candle_date_time_kst};
 const hits=n.filter(x=>x.event).length,rate=hits/n.length;
 const validated=validation.selected>=MIN_VALIDATION_SIGNALS&&validation.hits>=3&&validation.precision>validation.baseline*1.2&&validation.precision>validation.trainBase;
 const candidate=pre&&validated&&rate>=validation.cutoff;
 const category=candidate?'candidate':pre?'watch':'risk';
 const reason=!fresh?'분봉 데이터가 오래되어 후보 제외':!notAlreadyUp?'현재 24시간 상승률 +8% 초과: 이미 급등한 종목 제외':!pre?'초기 전조·거래대금·변동성 조건 미충족':!validated?'시간순 검증 근거 부족':'과거 유사 패턴 검토';
 return {market:t.market,name:t.meta?.korean_name||t.market,price:t.trade_price,change:t.signed_change_rate*100,
  f,rate,hits,neighbors:n.length,category,reason,date:history.at(-1).candle_date_time_kst};
}
$('scanPatterns').onclick=async()=>{
 if(scanBusy)return;
 if(!tickers.length){$('scanProgress').textContent='먼저 시세 연결을 기다려 주세요.';return}
 scanBusy=true;
 const btn=$('scanPatterns'),progress=$('scanProgress'),out=$('patternCandidates');
 btn.disabled=true;out.innerHTML='<p>과거 급등 및 비급등 사례를 수집하고 시간순 검증 중입니다. 처음 실행은 수 분 걸릴 수 있습니다.</p>';
 let failed=0,processed=0;
 try{
  const targets=[...tickers].filter(t=>t.acc_trade_price_24h>0&&!STABLE_SYMBOLS.has(t.market.slice(4)))
   .sort((a,b)=>b.acc_trade_price_24h-a.acc_trade_price_24h).slice(0,HIST_MARKETS);
  const records=[],train=[],test=[];
  for(const t of targets){
   progress.textContent='과거 자료 수집 '+(++processed)+'/'+targets.length+' · '+t.market;
   try{
    const history=await fetchHistory(t.market,(p,max)=>{progress.textContent='수집 '+processed+'/'+targets.length+' · '+t.market+' · '+p+'/'+max+'페이지'});
    if(history.length<500)throw Error('과거 봉 부족');
    const samples=historicalSamples(history);
    records.push({t,history});
    train.push(...samples.train);test.push(...samples.test);
   }catch(e){failed++;console.warn('Historical data:',t.market,e)}
   await pause(220);
  }
  if(train.length<100||test.length<30){
   out.innerHTML='<p>과거 데이터가 충분하지 않아 후보를 표시하지 않습니다. 수집 '+records.length+'종, 학습 '+train.length+'건, 검증 '+test.length+'건. API 조회 상태를 확인하세요.</p>';
   $('candidates').textContent='0';
   progress.textContent='학습 자료 부족 · 조회 실패 '+failed+'종';return;
  }
  // Global time cutoff prevents cross-market future leakage: no test-time sample is in training.
  const allSamples=[...train,...test];
  const orderedTimes=allSamples.map(x=>x.ts).sort((a,b)=>a-b);
  const cutoffTime=orderedTimes[Math.floor(orderedTimes.length*.7)];
  const chronologicalTrain=allSamples.filter(x=>x.ts<cutoffTime-HORIZON*HIST_INTERVAL*60000);
  const chronologicalTest=allSamples.filter(x=>x.ts>=cutoffTime);
  if(chronologicalTrain.length<100||chronologicalTest.length<30){
   out.textContent='공통 시간 기준 학습·검증 구간의 표본이 부족해 후보를 표시하지 않습니다.';
   $('candidates').textContent='0';progress.textContent='검증 표본 부족';return;
  }
  const validation=evaluateModel(chronologicalTrain,chronologicalTest);
  const assessments=records.map(x=>candidateAssessment(x.t,x.history,chronologicalTrain,validation)).filter(Boolean);
  const order={candidate:0,watch:1,risk:2};
  assessments.sort((a,b)=>order[a.category]-order[b.category]||b.rate-a.rate);
  const candidates=assessments.filter(x=>x.category==='candidate');
  $('candidates').textContent=String(candidates.length);
  const percent=x=>(x*100).toFixed(1)+'%';
  const validationText='학습 '+chronologicalTrain.length+'개 구간 / 시간순 검증 '+chronologicalTest.length+'개 구간 (초기 전조 조건 학습 '+validation.trainEligible+'개 · 검증 '+validation.total+'개) · 해당 구간 기본 급등률 '+percent(validation.baseline)+
   ' · 검증 신호 '+validation.selected+'건, 실제 성공 '+validation.hits+'건, 적중률 '+(validation.selected?percent(validation.precision):'표본 없음');
  const summary='<article class="pattern-card"><b>과거 실제 급등과 비급등 구간 비교</b><p>거래대금 상위 '+targets.length+'종 중 '+records.length+'종 분석 · 15분봉 종목당 최대 '+(HIST_PAGES*200)+'개 · 60분 내 +3%를 급등 사건으로 정의</p><p>'+esc(validationText)+'</p><p>전체 종목에 공통 시간 경계(앞 70%/뒤 30%)를 적용하고 시간 경계의 겹치는 사건을 제외합니다. 이미 급등한 종목(24시간 +8% 초과, 3시간 +3% 초과 등)은 전조 후보에서 제외합니다. 검증 성과가 충분하지 않으면 급등 후보를 표시하지 않습니다. 시간대가 겹치는 표본과 종목 간 상관이 있으므로 이 수치는 미래 상승 확률이 아닙니다.</p></article>';
  const renderAssessment=c=>{
   const label=c.category==='candidate'?'초기 급등 전조 후보 (제한적 검증)':c.category==='watch'?'관찰 전용 · 검증 부족':'전조 제외 · 조건 미충족';
   const details=c.f.map((x,i)=>featureNames[i]+': '+(i===7||i===8?(x*100).toFixed(1)+'%':i===4||i===5?x.toFixed(2)+'배':x.toFixed(2)+'%'));
   return '<article class="pattern-card"><div class="pattern-head"><b>'+esc(c.name)+' <small>'+esc(c.market)+'</small></b><span>'+label+'</span></div>'+
    '<p>현재 '+fmt(c.price,8)+'원 · 24시간 '+c.change.toFixed(2)+'% · 확정 15분봉 '+esc(c.date)+'</p>'+
    '<p><b>판단: '+esc(c.reason)+'</b></p><p>학습 구간 유사 사례 '+c.neighbors+'건 · 이후 60분 내 +3% '+c.hits+'건 ('+percent(c.rate)+')</p>'+
    '<ul>'+details.map(d=>'<li>'+esc(d)+'</li>').join('')+'</ul>'+
    '<button data-add-watch="'+esc(c.market)+'">☆ 관심 종목 등록</button></article>';
  };
  const excluded=assessments.filter(x=>x.category!=='candidate');
  out.innerHTML=summary+(candidates.length?candidates.map(renderAssessment).join(''):'<article class="pattern-card"><b>현재 검증 기준을 통과한 초기 급등 전조 후보가 없습니다.</b><p>이미 급등한 종목과 검증이 부족한 종목은 후보 목록에서 제외했습니다. 조건을 임의로 낮춰 후보를 만들지 않습니다.</p></article>')+
   (excluded.length?'<details><summary>관찰·제외 종목 '+excluded.length+'종 보기 (기본 숨김)</summary>'+excluded.map(renderAssessment).join('')+'</details>':'');
  progress.textContent='완료 · '+records.length+'종 과거 수집 · '+candidates.length+'종 급등 후보 · '+failed+'종 조회 실패 · '+new Date().toLocaleTimeString('ko-KR');
 }catch(e){out.textContent='분석 오류: '+e.message;progress.textContent='분석 실패'}
 finally{btn.disabled=false;scanBusy=false}
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
