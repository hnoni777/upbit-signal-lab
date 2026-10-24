'use strict';
/* v27: two-month historical spike precursor similarity, distinct from predicted probability.
   The 60-day daily screen finds events; 15m candles ending BEFORE the event day form
   exemplars. Current 15m candles are compared without future data. */
(()=>{
 const DAYS=60,DAILY_LIMIT=100,EVENT_LIMIT=30,CURRENT_LIMIT=45;
 const CACHE_KEY='usl-60d-event-v1';
 const $=id=>document.getElementById(id);
 const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const endpoint=path=>API+path;
 async function json(path){
  for(let i=0;i<3;i++){
   try{
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
    let response;
    try{response=await fetch(endpoint(path),{signal:ctrl.signal})}finally{clearTimeout(timer)}
    if(!response.ok)throw Error('HTTP '+response.status);
    const data=await response.json();
    if(!Array.isArray(data))throw Error('API 배열 오류');
    return data;
   }catch(e){if(i===2)throw e;await sleep(500*(i+1))}
  }
 }
 function ascending(xs){return xs.sort((a,b)=>a.candle_date_time_utc.localeCompare(b.candle_date_time_utc))}
 function vector(c){
  if(c.length<97)return null;
  const x=c.slice(-97),end=x.at(-1),old=x[0];
  const t0=Date.parse(old.candle_date_time_utc+'Z'),t1=Date.parse(end.candle_date_time_utc+'Z');
  if(t1-t0!==96*900000)return null;
  for(let i=1;i<x.length;i++)if(Date.parse(x[i].candle_date_time_utc+'Z')-Date.parse(x[i-1].candle_date_time_utc+'Z')!==900000)return null;
  const avg=a=>a.reduce((s,y)=>s+Number(y.candle_acc_trade_price||0),0)/a.length;
  const price=(i)=>Number(x.at(i).trade_price);
  const volBase=avg(x.slice(0,96));
  const high=Math.max(...x.slice(0,96).map(y=>Number(y.high_price)));
  const low=Math.min(...x.slice(-24).map(y=>Number(y.low_price)));
  const hi=Math.max(...x.slice(-24).map(y=>Number(y.high_price)));
  const up=x.slice(-12).filter(y=>y.trade_price>y.opening_price).reduce((s,y)=>s+Number(y.candle_acc_trade_price||0),0);
  const total=x.slice(-12).reduce((s,y)=>s+Number(y.candle_acc_trade_price||0),0);
  const v=[
   (price(-1)/price(-5)-1)*100,
   (price(-1)/price(-13)-1)*100,
   (price(-1)/price(-25)-1)*100,
   (price(-1)/price(0)-1)*100,
   avg(x.slice(-4))/Math.max(volBase,1),
   avg(x.slice(-12))/Math.max(volBase,1),
   (hi-low)/Math.max(price(-1),1e-12)*100,
   price(-1)/Math.max(high,1e-12),
   total>0?up/total:.5
  ];
  return v.every(Number.isFinite)?v:null;
 }
 const scale=[2,4,7,15,2,2,5,.06,.35];
 const dist=(a,b)=>Math.sqrt(a.reduce((s,v,i)=>s+Math.min(16,((v-b[i])/scale[i])**2),0)/a.length);
 async function priorCandles(market,to){
  const q='/candles/minutes/15?market='+encodeURIComponent(market)+'&count=200'+(to?'&to='+encodeURIComponent(to):'');
  const data=await json(q);
  const now=Math.floor(Date.now()/900000)*900000;
  return ascending(data.filter(x=>Date.parse(x.candle_date_time_utc+'Z')<now));
 }
 async function buildExamples(selected,progress){
  const events=[],errors=[];
  for(let i=0;i<selected.length;i++){
   const t=selected[i];
   progress('60일 급등 사례 조사 '+(i+1)+'/'+selected.length+' · '+t.market);
   try{
    const daily=await json('/candles/days?market='+encodeURIComponent(t.market)+'&count=65');
    // Daily candle is from 09:00 KST to next 09:00 KST. Exclude the unfinished day.
    const complete=daily.filter(d=>Date.now()-Date.parse(d.candle_date_time_utc+'Z')>=86400000);
    for(const d of complete.slice(0,DAYS)){
     const open=Number(d.opening_price),high=Number(d.high_price);
     const gain=(high/open-1)*100;
     if(gain>=10&&Number(d.candle_acc_trade_price)>=100000000){
      events.push({market:t.market,name:t.meta?.korean_name||t.market,date:d.candle_date_time_utc,gain,turnover:Number(d.candle_acc_trade_price)});
     }
    }
   }catch(e){errors.push(t.market+': '+e.message)}
   if(i%4===0)await sleep(160);
  }
  // Diversify event coins so one volatile coin cannot dominate the example bank.
  events.sort((a,b)=>b.gain-a.gain);
  const perCoin=new Map(),picked=[];
  for(const e of events){
   const n=perCoin.get(e.market)||0;
   if(n>=2)continue;
   picked.push(e);perCoin.set(e.market,n+1);
   if(picked.length>=EVENT_LIMIT)break;
  }
  const examples=[];
  for(let i=0;i<picked.length;i++){
   const e=picked[i];
   progress('급등 직전 15분봉 추출 '+(i+1)+'/'+picked.length+' · '+e.market);
   try{
    // The event day's opening is 00:00 UTC for Upbit daily candles (09:00 KST).
    // The cursor is exclusive: no price information from the spike day enters features.
    const history=await priorCandles(e.market,e.date+'Z');
    const f=vector(history);
    if(f)examples.push({...e,f});
   }catch(err){errors.push(e.market+' 과거 분봉: '+err.message)}
   if(i%4===0)await sleep(140);
  }
  return {examples,events:events.length,scanned:selected.length,errors:errors.length,at:Date.now()};
 }
 function cached(){
  try{const v=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');return v&&Date.now()-v.at<86400000?v:null}catch(e){return null}
 }
 function save(v){try{localStorage.setItem(CACHE_KEY,JSON.stringify(v))}catch(e){}}
 const note='유사도는 과거 급등 직전 모양의 거리일 뿐 미래 상승 확률이나 매수 신호가 아닙니다. 과거 사건은 일봉 고가가 시가 대비 +10% 이상인 날로 정의하며, 그날 시작 전까지의 15분봉만 비교합니다.';
 async function scan(){
  const btn=$('scanPatterns'),out=$('patternCandidates'),progress=$('scanProgress');
  if(btn.disabled)return;
  if(!tickers.length){progress.textContent='시세 연결 후 다시 실행해 주세요.';return}
  btn.disabled=true;out.innerHTML='<p>최근 60일 급등 사례를 조사하고, 급등 발생일 이전 패턴을 추출합니다. 첫 실행에는 시간이 걸릴 수 있습니다.</p>';
  try{
   const eligible=tickers.filter(t=>t.market.startsWith('KRW-')&&!STABLE_SYMBOLS.has(t.market.slice(4))&&Number(t.acc_trade_price_24h)>=100000000)
    .sort((a,b)=>b.acc_trade_price_24h-a.acc_trade_price_24h);
   const selected=eligible.slice(0,DAILY_LIMIT);
   let db=cached();
   if(!db){db=await buildExamples(selected,s=>progress.textContent=s);save(db)}
   if(!db.examples.length){
    progress.textContent='급등 전조 학습 표본 없음';
    out.innerHTML='<p>급등 발생일 직전의 유효한 15분봉을 수집하지 못했습니다. API 접근이나 데이터 연속성을 확인해야 합니다. 임의의 후보는 표시하지 않습니다.</p>';
    $('candidates').textContent='0';return;
   }
   const current=eligible.filter(t=>t.signed_change_rate*100<=8&&t.signed_change_rate*100>=-12).slice(0,CURRENT_LIMIT);
   const matches=[],fail=[];
   for(let i=0;i<current.length;i++){
    const t=current[i];progress.textContent='현재 패턴 비교 '+(i+1)+'/'+current.length+' · '+t.market;
    try{
     const f=vector(await priorCandles(t.market,''));
     if(!f)continue;
     const ranked=db.examples.map(e=>({e,d:dist(f,e.f)})).sort((a,b)=>a.d-b.d);
     const nearest=ranked[0];
     // Show a ranking, not a fabricated minimum confidence threshold.
     matches.push({t,f,nearest,similarity:Math.round(100/(1+nearest.d)),comparisons:ranked.length});
    }catch(e){fail.push(t.market)}
    if(i%5===0)await sleep(160);
   }
   matches.sort((a,b)=>a.nearest.d-b.nearest.d);
   const top=matches.slice(0,10);
   $('candidates').textContent=String(top.length);
   progress.textContent='60일 조사 '+db.scanned+'종 · 급등 사건 '+db.events+'건 · 전조 표본 '+db.examples.length+'건 · 현재 비교 '+matches.length+'종 · 상위 '+top.length+'종';
   out.innerHTML='<article class="pattern-card"><b>최근 60일 실제 급등 직전 패턴 유사도 TOP 10</b><p>'+escape(progress.textContent)+'</p><p>'+escape(note)+'</p><p>조사 대상은 거래대금 상위 최대 '+DAILY_LIMIT+'종, 현재 비교는 최대 '+CURRENT_LIMIT+'종입니다. 원화마켓 전체를 분석한 결과는 아닙니다. 과거 패턴 DB는 24시간 동안 재사용합니다.</p></article>'+
    (top.length?top.map((m,i)=>'<article class="pattern-card"><div class="pattern-head"><b>'+(i+1)+'. '+escape(m.t.meta?.korean_name||m.t.market)+' <small>'+escape(m.t.market)+'</small></b><span>형태 유사도 '+m.similarity+'/100</span></div><p>현재 '+Number(m.t.trade_price).toLocaleString('ko-KR',{maximumFractionDigits:8})+'원 · 24시간 '+(m.t.signed_change_rate*100).toFixed(2)+'%</p><p>가장 유사한 과거 사례: '+escape(m.nearest.e.name)+' ('+escape(m.nearest.e.market)+') · '+escape(m.nearest.e.date.slice(0,10))+' · 당시 일봉 시가 대비 고가 +'+m.nearest.e.gain.toFixed(1)+'%</p><p>현재 1시간 '+m.f[0].toFixed(2)+'% · 3시간 '+m.f[1].toFixed(2)+'% · 1시간 거래대금 '+m.f[4].toFixed(2)+'배 · 3시간 거래대금 '+m.f[5].toFixed(2)+'배</p><p>이 사례와 비슷하다는 것은 향후 같은 상승폭을 뜻하지 않습니다.</p><button data-add-watch="'+escape(m.t.market)+'">☆ 관심 종목 등록</button></article>').join(''):'<p>현재 비교 가능한 연속 15분봉이 없습니다.</p>');
  }catch(e){progress.textContent='유사도 분석 실패';out.textContent='분석 실패: '+e.message}
  finally{btn.disabled=false}
 }
 $('scanPatterns').onclick=scan;
})();
