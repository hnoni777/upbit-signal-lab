'use strict';
/* v33 standalone 08-10 KST two-year historical event similarity. No fabricated odds. */
(()=>{
 const API='https://upbit-signal-proxy.parkdam6.workers.dev/v1';
 const KEY='usl-morning-2y-v1',MAX_MARKETS=35,MAX_EVENTS=70,MAX_CURRENT=45;
 const $=id=>document.getElementById(id),sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const nowKst=()=>new Date(Date.now()+9*3600000).toISOString().slice(11,16);
 let busy=false,markets=[],tickers=[];
 async function get(path){
  for(let n=0;n<3;n++){
   const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),18000);
   try{const r=await fetch(API+path,{signal:ctl.signal});if(!r.ok)throw Error('HTTP '+r.status);const data=await r.json();if(!Array.isArray(data))throw Error('잘못된 응답');return data}
   catch(e){if(n===2)throw e;await sleep(700*(n+1))}
   finally{clearTimeout(timer)}
  }
 }
 const stamp=s=>Date.parse(s+'Z');
 const asc=a=>a.sort((x,y)=>x.candle_date_time_utc.localeCompare(y.candle_date_time_utc));
 function vector(rows){
  if(rows.length<97)return null;
  const x=rows.slice(-97),t0=stamp(x[0].candle_date_time_utc);
  for(let i=1;i<x.length;i++)if(stamp(x[i].candle_date_time_utc)!==t0+i*900000)return null;
  const avg=a=>a.reduce((s,c)=>s+Number(c.candle_acc_trade_price||0),0)/a.length;
  const p=i=>Number(x.at(i).trade_price),base=avg(x.slice(0,96));
  const up=x.slice(-12).filter(c=>Number(c.trade_price)>Number(c.opening_price)).reduce((s,c)=>s+Number(c.candle_acc_trade_price||0),0);
  const total=x.slice(-12).reduce((s,c)=>s+Number(c.candle_acc_trade_price||0),0);
  const f=[(p(-1)/p(-5)-1)*100,(p(-1)/p(-13)-1)*100,(p(-1)/p(-25)-1)*100,(p(-1)/p(0)-1)*100,avg(x.slice(-4))/Math.max(base,1),avg(x.slice(-12))/Math.max(base,1),p(-1)/Math.max(...x.slice(0,96).map(c=>Number(c.high_price))),total?up/total:.5];
  return f.every(Number.isFinite)?f:null;
 }
 const scale=[2,4,7,15,2,2,.06,.35];
 const distance=(a,b)=>Math.sqrt(a.reduce((s,x,i)=>s+Math.min(16,((x-b[i])/scale[i])**2),0)/a.length);
 const empty=()=>({version:1,done:[],events:[],examples:[],at:Date.now()});
 function read(){try{const d=JSON.parse(localStorage.getItem(KEY)||'null');return d?.version===1&&Array.isArray(d.done)&&Array.isArray(d.events)&&Array.isArray(d.examples)?d:empty()}catch(e){return empty()}}
 function save(d){try{localStorage.setItem(KEY,JSON.stringify(d))}catch(e){$('progress').textContent='저장 공간 부족: 데이터 저장에 실패했습니다.'}}
 function stats(d){$('scanned').textContent=d.done.length;$('samples').textContent=d.examples.length}
 async function marketData(){
  if(!markets.length)markets=(await get('/market/all?isDetails=false')).filter(m=>m.market.startsWith('KRW-'));
  const t=[];
  for(let i=0;i<markets.length;i+=70)t.push(...await get('/ticker?markets='+encodeURIComponent(markets.slice(i,i+70).map(x=>x.market).join(','))));
  tickers=t.map(x=>({...x,meta:markets.find(m=>m.market===x.market)}));
  $('status').textContent='업비트 연결됨';
 }
 async function twoYears(market){
  let to='',all=new Map();
  for(let page=0;page<4;page++){
   const batch=await get('/candles/days?market='+encodeURIComponent(market)+'&count=200'+(to?'&to='+encodeURIComponent(to):''));
   if(!batch.length)break;
   for(const c of batch)all.set(c.candle_date_time_utc,c);
   const last=batch.at(-1).candle_date_time_utc;
   if(batch.length<200||to===last+'Z')break;
   to=last+'Z';await sleep(140);
  }
  const cutoff=Date.now()-731*86400000;
  return [...all.values()].filter(c=>stamp(c.candle_date_time_utc)>cutoff&&stamp(c.candle_date_time_utc)<Date.now()-86400000);
 }
 async function eventBars(market,day){
  // 11:00 KST = 02:00 UTC; exclusive cursor. Two pages cover prior day + event morning.
  const to=day.slice(0,10)+'T02:00:00Z',all=new Map();let cursor=to;
  for(let page=0;page<2;page++){
   const batch=await get('/candles/minutes/15?market='+encodeURIComponent(market)+'&count=200&to='+encodeURIComponent(cursor));
   if(!batch.length)break;
   for(const c of batch)all.set(c.candle_date_time_utc,c);
   const last=batch.at(-1).candle_date_time_utc;
   if(batch.length<200||last+'Z'===cursor)break;
   cursor=last+'Z';await sleep(140);
  }
  return asc([...all.values()]);
 }
 function extract(event,rows){
  const start=stamp(event.day+'Z')+(-3600000); // day starts 09:00 KST; 08:00 is one hour earlier
  const within=rows.filter(c=>{const t=stamp(c.candle_date_time_utc);return t>=start&&t<start+7200000});
  if(within.length<5)return null;
  const first=within.find(c=>stamp(c.candle_date_time_utc)===start);
  if(!first)return null;
  const open=Number(first.opening_price);
  // Find first +3% intraday bar only if the 08:00-10:00 window eventually reaches +10%.
  const high=Math.max(...within.map(c=>Number(c.high_price)));
  if(high<open*1.10)return null;
  const onset=within.find(c=>Number(c.high_price)>=open*1.03);
  if(!onset)return null;
  const idx=rows.findIndex(c=>c.candle_date_time_utc===onset.candle_date_time_utc);
  // Strictly BEFORE onset candle. Feature window ends at preceding closed candle.
  const f=vector(rows.slice(0,idx));
  if(!f)return null;
  return {...event,f,onset:onset.candle_date_time_utc,peakPct:(high/open-1)*100};
 }
 async function learn(d,selected){
  const remaining=selected.filter(t=>!d.done.includes(t.market));
  for(let i=0;i<remaining.length;i++){
   const t=remaining[i];$('progress').textContent='2년 일봉 조사 '+(d.done.length+1)+'/'+selected.length+' · '+t.market;
   try{
    const days=await twoYears(t.market);
    for(const c of days){
     // Broad daily filter, final +10% determination uses 08:00-10:00 15m candles.
     if(Number(c.high_price)/Number(c.opening_price)>=1.08&&Number(c.candle_acc_trade_price)>=1e8){
      const date=c.candle_date_time_utc.slice(0,10);d.events.push({market:t.market,name:t.meta?.korean_name||t.market,day:date});const next=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);if(Date.parse(next+'T00:00:00Z')<Date.now()-86400000)d.events.push({market:t.market,name:t.meta?.korean_name||t.market,day:next});
     }
    }
    d.done.push(t.market);save(d);stats(d);
   }catch(e){$('progress').textContent='조사 실패 '+t.market+' · '+e.message+' (재시도 가능)'}
   await sleep(160);
  }
  // Daily candle boundaries are 09:00 KST; check both the screened date and following morning to cover 08:00-09:00.
  // Events are only screening candidates; each gets checked with intraday bars.
  const unique=[...new Map(d.events.map(e=>[e.market+'|'+e.day,e])).values()];
  unique.sort((a,b)=>b.day.localeCompare(a.day));const chosen=[],perCoin=new Map();for(const e of unique){const n=perCoin.get(e.market)||0;if(n>=4)continue;chosen.push(e);perCoin.set(e.market,n+1);if(chosen.length>=MAX_EVENTS)break}
  for(let i=0;i<chosen.length;i++){
   const e=chosen[i],id=e.market+'|'+e.day;
   if(d.examples.some(x=>x.market+'|'+x.day===id))continue;
   $('progress').textContent='08~10시 급등 전조 확인 '+(i+1)+'/'+chosen.length+' · '+e.market+' · '+e.day;
   try{const sample=extract(e,await eventBars(e.market,e.day));if(sample){d.examples.push(sample);save(d);stats(d)}}
   catch(err){$('progress').textContent='과거 분봉 조회 실패 '+e.market+': '+err.message}
   await sleep(150);
  }
  save(d);
 }
 async function currentVector(market){
  const data=await get('/candles/minutes/15?market='+encodeURIComponent(market)+'&count=120');
  const limit=Math.floor(Date.now()/900000)*900000;
  return vector(asc(data.filter(c=>stamp(c.candle_date_time_utc)<limit)));
 }
 async function rank(d){
  if(!d.examples.length){$('results').innerHTML='<p>08~10시 실제 +10% 급등 전조 표본을 확보하지 못했습니다. 무작위 후보는 표시하지 않습니다. 조사 범위와 API 접근을 확인해 주세요.</p>';$('compared').textContent='0';return}
  const selected=tickers.filter(t=>t.market.startsWith('KRW-')&&Number(t.acc_trade_price_24h)>1e8&&t.signed_change_rate<.10&&t.signed_change_rate>-.15).sort((a,b)=>b.acc_trade_price_24h-a.acc_trade_price_24h).slice(0,MAX_CURRENT);
  const matches=[];
  for(let i=0;i<selected.length;i++){
   const t=selected[i];$('progress').textContent='현재 패턴 비교 '+(i+1)+'/'+selected.length+' · '+t.market;
   try{const f=await currentVector(t.market);if(!f)continue;const best=d.examples.map(e=>({e,dist:distance(f,e.f)})).sort((a,b)=>a.dist-b.dist)[0];matches.push({t,f,best,similarity:Math.round(100/(1+best.dist))})}
   catch(e){}
   if(i%5===0)await sleep(140);
  }
  matches.sort((a,b)=>a.best.dist-b.best.dist);
  $('compared').textContent=matches.length;
  const top=matches.slice(0,5);
  const time=nowKst(),inWindow=time>='08:00'&&time<'10:00';
  $('results').innerHTML='<p>'+ (inWindow?'현재 오전 8~10시 관찰 구간입니다.':'현재는 오전 8~10시 밖입니다. 표시된 유사도는 해당 시간대 급등 예측이 아닙니다.')+'</p>'+top.map((m,i)=>'<article class="item"><span class="score">유사도 '+m.similarity+'/100</span><h3>'+(i+1)+'. '+esc(m.t.meta?.korean_name||m.t.market)+' <small>'+esc(m.t.market)+'</small></h3><p>현재가 '+Number(m.t.trade_price).toLocaleString('ko-KR',{maximumFractionDigits:8})+'원 · 24시간 '+(m.t.signed_change_rate*100).toFixed(2)+'%</p><p>1시간 '+m.f[0].toFixed(2)+'% · 3시간 '+m.f[1].toFixed(2)+'% · 1시간 거래대금 '+m.f[4].toFixed(2)+'배</p><p>과거 유사 사례: '+esc(m.best.e.name)+' · '+esc(m.best.e.day)+' · 08~10시 최고 +'+m.best.e.peakPct.toFixed(1)+'%</p></article>').join('')+(top.length?'':'<p>비교 가능한 현재 15분봉이 없습니다.</p>');
  $('progress').textContent='2년 조사 '+d.done.length+'종 · 08~10시 급등 전조 표본 '+d.examples.length+'건 · 현재 비교 '+matches.length+'종 · TOP '+top.length;
 }
 async function run(train){
  if(busy)return;busy=true;$('start').disabled=$('refresh').disabled=$('reset').disabled=true;
  try{await marketData();const d=read();stats(d);
   if(train){const selected=tickers.filter(t=>Number(t.acc_trade_price_24h)>1e8).sort((a,b)=>b.acc_trade_price_24h-a.acc_trade_price_24h).slice(0,MAX_MARKETS);await learn(d,selected)}
   await rank(d);
  }catch(e){$('progress').textContent='실행 실패: '+e.message}
  finally{busy=false;$('start').disabled=$('refresh').disabled=$('reset').disabled=false}
 }
 $('start').onclick=()=>run(true);
 $('refresh').onclick=()=>run(false);
 $('reset').onclick=()=>{if(!confirm('저장된 2년 학습 데이터를 모두 삭제할까요?'))return;localStorage.removeItem(KEY);stats(empty());$('compared').textContent='0';$('results').innerHTML='<p>학습 데이터가 초기화되었습니다.</p>'};
 stats(read());$('status').textContent='실행 대기';
})();
