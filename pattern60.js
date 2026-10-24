'use strict';
/* v30: one-year spike event research, intraday onset detection and strictly pre-onset features. */
(()=>{
 const DAYS=365,DAILY_LIMIT=100,EVENT_LIMIT=60,CURRENT_LIMIT=45;
 const CACHE_KEY='usl-365d-intraday-onset-v3';
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
 async function eventCandles(market,start){
  const end=new Date(Date.parse(start+'Z')+86400000).toISOString().slice(0,19)+'Z';
  const seen=new Map();let to=end;
  // 2 x 200 fifteen-minute candles cover the event day plus 24h of precursors.
  for(let page=0;page<2;page++){
   const batch=await json('/candles/minutes/15?market='+encodeURIComponent(market)+'&count=200&to='+encodeURIComponent(to));
   if(!batch.length)break;
   for(const c of batch)seen.set(c.candle_date_time_utc,c);
   const oldest=batch.at(-1).candle_date_time_utc;
   if(batch.length<200||oldest+'Z'===to)break;
   to=oldest+'Z';
   await sleep(130);
  }
  return ascending([...seen.values()]);
 }
 function onsetSamples(e,candles){
  const dayStart=Date.parse(e.date+'Z'),dayEnd=dayStart+86400000;
  const day=candles.filter(c=>{const t=Date.parse(c.candle_date_time_utc+'Z');return t>=dayStart&&t<dayEnd});
  if(!day.length)return [];
  const opening=Number(day[0].opening_price);
  // First 15-minute bar whose HIGH crosses +3% from the day's opening.
  // This is an operational onset proxy, not proof of the precise first trade.
  const onset=day.find(c=>Number(c.high_price)>=opening*1.03);
  if(!onset)return [];
  const onsetTime=Date.parse(onset.candle_date_time_utc+'Z');
  const startIndex=candles.findIndex(c=>c.candle_date_time_utc===onset.candle_date_time_utc);
  const stages=[{hours:6,bars:24},{hours:3,bars:12},{hours:1,bars:4}];
  const result=[];
  for(const stage of stages){
   // Last input candle must finish before the onset candle opens.
   const endIndex=startIndex-stage.bars-1;
   if(endIndex<96)continue;
   const f=vector(candles.slice(0,endIndex+1));
   if(!f)continue;
   const last=Date.parse(candles[endIndex].candle_date_time_utc+'Z');
   if(onsetTime-last!==(stage.bars+1)*900000)continue;
   result.push({...e,f,stageHours:stage.hours,onsetTime:new Date(onsetTime).toISOString(),onsetRule:'당일 시가 대비 고가 +3% 첫 15분봉'});
  }
  return result;
 }
 async function yearDaily(market){
  const all=new Map();let to='';
  for(let page=0;page<3;page++){
   const path='/candles/days?market='+encodeURIComponent(market)+'&count=200'+(to?'&to='+encodeURIComponent(to):'');
   const batch=await json(path);
   if(!batch.length)break;
   for(const d of batch)all.set(d.candle_date_time_utc,d);
   const oldest=batch.at(-1).candle_date_time_utc;
   if(batch.length<200||oldest+'Z'===to)break;
   to=oldest+'Z';
   if(all.size>=DAYS+2)break;
   await sleep(130);
  }
  return [...all.values()].sort((a,b)=>b.candle_date_time_utc.localeCompare(a.candle_date_time_utc));
 }
 async function buildExamples(selected,progress){
  const events=[],errors=[];
  for(let i=0;i<selected.length;i++){
   const t=selected[i];
   progress('365일 급등 사례 조사 '+(i+1)+'/'+selected.length+' · '+t.market);
   try{
    const daily=await yearDaily(t.market);
    // Daily candle is from 09:00 KST to next 09:00 KST. Exclude the unfinished day.
    const complete=daily.filter(d=>Date.now()-Date.parse(d.candle_date_time_utc+'Z')>=86400000&&Date.now()-Date.parse(d.candle_date_time_utc+'Z')<=366*86400000);
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
  const examples=[];let detectedOnsets=0;
  for(let i=0;i<picked.length;i++){
   const e=picked[i];
   progress('급등 직전 15분봉 추출 '+(i+1)+'/'+picked.length+' · '+e.market);
   try{
    const history=await eventCandles(e.market,e.date);
    const samples=onsetSamples(e,history);
    if(samples.length){detectedOnsets++;examples.push(...samples)}
   }catch(err){errors.push(e.market+' 과거 분봉: '+err.message)}
   if(i%4===0)await sleep(140);
  }
  return {examples,detectedOnsets,events:events.length,scanned:selected.length,errors:errors.length,at:Date.now()};
 }
 function cached(){
  try{const v=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');return v&&Array.isArray(v.examples)&&v.examples.length?v:null}catch(e){return null}
 }
 function save(v){try{localStorage.setItem(CACHE_KEY,JSON.stringify(v))}catch(e){}}
 const note='급등 사례는 일봉 시가 대비 고가 +10% 이상인 날입니다. 그날 시가 대비 고가가 처음 +3%에 도달한 15분봉을 급등 시작의 대리 지표로 사용하며, 해당 봉 및 이후 데이터는 특징 계산에서 제외합니다. 1·3·6시간 전 패턴을 각각 비교합니다. 유사도는 상승 확률이 아닙니다.';
 function classifyCurrent(f,change){
  const [r1,r3,r6,r24,v1,v3,range,nearHigh,upShare]=f;
  const risingVolume=v1>=1.15&&v3>=.85;
  const improving=r1>=0&&r1>=r3/3&&upShare>=.52;
  const stabilizing=r1>=-.4&&r3>=-2&&upShare>=.45&&nearHigh>=.90;
  const chasing=r1>2||r3>4||r6>7||change>8;
  if(!chasing&&risingVolume&&(improving||stabilizing)&&r6>=-5)return {kind:'recovery',label:'상승 전환 징후',why:improving?'단기 가격 회복·양봉 거래대금·거래대금 증가':'하락 둔화·고점 근접·거래대금 증가'};
  if(r1<0&&r3<0&&(r1<r3/3||upShare<.45))return {kind:'decline',label:'하락세 지속',why:'1·3시간 가격 약세와 양봉 거래대금 비중 부족'};
  return {kind:'neutral',label:'방향 미확인',why:chasing?'이미 단기 상승폭이 커 추격 위험':'상승 전환 조건과 하락 지속 조건 모두 불충족'};
 }
 async function scan(){
  const btn=$('scanPatterns'),rebuild=$('rebuildPatterns'),out=$('patternCandidates'),progress=$('scanProgress');
  if(btn.disabled||rebuild.disabled)return;
  if(!tickers.length){progress.textContent='시세 연결 후 다시 실행해 주세요.';return}
  btn.disabled=true;rebuild.disabled=true;out.innerHTML='<p>저장된 과거 패턴이 있으면 그대로 사용하고 현재 코인만 새로 비교합니다. 저장된 패턴이 없다면 최초 1회 수집합니다.</p>';
  try{
   const eligible=tickers.filter(t=>t.market.startsWith('KRW-')&&!STABLE_SYMBOLS.has(t.market.slice(4))&&Number(t.acc_trade_price_24h)>=100000000)
    .sort((a,b)=>b.acc_trade_price_24h-a.acc_trade_price_24h);
   const selected=eligible.slice(0,DAILY_LIMIT);
   let db=cached();
   if(!db){db=await buildExamples(selected,s=>progress.textContent=s);if(db.examples.length)save(db)}
   else progress.textContent='저장된 과거 패턴 '+db.examples.length+'건 재사용 · '+new Date(db.at).toLocaleDateString('ko-KR')+' 생성';
   if(!db.examples.length){
    progress.textContent='급등 전조 학습 표본 없음';
    out.innerHTML='<p>급등 시작 1·3·6시간 전의 유효한 15분봉을 수집하지 못했습니다. API 접근이나 데이터 연속성을 확인해야 합니다. 임의의 후보는 표시하지 않습니다.</p>';
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
     matches.push({t,f,nearest,trend:classifyCurrent(f,t.signed_change_rate*100),similarity:Math.round(100/(1+nearest.d)),comparisons:ranked.length});
    }catch(e){fail.push(t.market)}
    if(i%5===0)await sleep(160);
   }
   matches.sort((a,b)=>a.nearest.d-b.nearest.d);
   const recovery=matches.filter(m=>m.trend.kind==='recovery').slice(0,10);
   const neutral=matches.filter(m=>m.trend.kind==='neutral').slice(0,10);
   const decline=matches.filter(m=>m.trend.kind==='decline').slice(0,10);
   $('candidates').textContent=String(recovery.length);
   progress.textContent='저장된 과거 패턴 '+db.examples.length+'건 · 현재 '+matches.length+'종 비교 · 상승 전환 '+matches.filter(m=>m.trend.kind==='recovery').length+'종 · 방향 미확인 '+matches.filter(m=>m.trend.kind==='neutral').length+'종 · 하락 지속 '+matches.filter(m=>m.trend.kind==='decline').length+'종';
   const card=(m,i)=>'<article class="pattern-card"><div class="pattern-head"><b>'+(i+1)+'. '+escape(m.t.meta?.korean_name||m.t.market)+' <small>'+escape(m.t.market)+'</small></b><span>유사도 '+m.similarity+'/100</span></div><p><b>'+escape(m.trend.label)+'</b> · '+escape(m.trend.why)+'</p><p>현재 '+Number(m.t.trade_price).toLocaleString('ko-KR',{maximumFractionDigits:8})+'원 · 24시간 '+(m.t.signed_change_rate*100).toFixed(2)+'%</p><p>과거 유사 사례: '+escape(m.nearest.e.name)+' · '+escape(m.nearest.e.date.slice(0,10))+' · 급등 시작 '+m.nearest.e.stageHours+'시간 전 · 당시 일봉 고가 +'+m.nearest.e.gain.toFixed(1)+'%</p><p>현재 1시간 '+m.f[0].toFixed(2)+'% · 3시간 '+m.f[1].toFixed(2)+'% · 1시간 거래대금 '+m.f[4].toFixed(2)+'배 · 3시간 거래대금 '+m.f[5].toFixed(2)+'배 · 최근 3시간 양봉 거래대금 '+(m.f[8]*100).toFixed(1)+'%</p><button data-add-watch="'+escape(m.t.market)+'">☆ 관심 종목 등록</button></article>';
   const group=(title,items,empty)=>'<section><h3>'+title+' · '+items.length+'종 표시</h3>'+(items.length?items.map(card).join(''):'<p>'+empty+'</p>')+'</section>';
   out.innerHTML='<article class="pattern-card"><b>1년 급등 전 패턴 유사도 + 현재 흐름 분류</b><p>'+escape(progress.textContent)+'</p><p>'+escape(note)+'</p><p>유사도 순으로 각 그룹 최대 10종을 표시합니다. 상승 전환은 거래대금과 가격 흐름의 관찰 분류이지 급등 예측이나 매수 신호가 아닙니다.</p></article>'+
    group('상승 전환 징후',recovery,'현재 상승 전환 조건을 만족하는 종목이 없습니다.')+
    group('방향 미확인',neutral,'방향 미확인 종목이 없습니다.')+
    group('하락세 지속',decline,'하락세 지속으로 분류된 종목이 없습니다.');

  }catch(e){progress.textContent='유사도 분석 실패';out.textContent='분석 실패: '+e.message}
  finally{btn.disabled=false;rebuild.disabled=false}
 }
 $('scanPatterns').onclick=scan;
 $('rebuildPatterns').onclick=()=>{
  if(!confirm('저장된 과거 패턴을 삭제하고 1년치 자료를 다시 수집할까요? 첫 수집에는 시간이 오래 걸립니다.'))return;
  try{localStorage.removeItem(CACHE_KEY)}catch(e){$('scanProgress').textContent='저장된 패턴을 삭제하지 못했습니다.';return}
  scan();
 };
})();
