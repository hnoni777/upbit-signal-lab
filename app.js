'use strict';
/* v40: fixed-time, leakage-safe positive/negative pattern learner + chronological holdout */
(()=>{
const API='https://upbit-signal-proxy.parkdam6.workers.dev/v1',KEY='usl-morning-v36-dataset',LIMIT=35,EVENT_LIMIT=420,CONTROL_LIMIT=140,STEP=900000;
const $=x=>document.getElementById(x),sleep=ms=>new Promise(r=>setTimeout(r,ms)),esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let busy=false,markets=[],tickers=[];
async function get(path){for(let i=0;i<3;i++){const a=new AbortController(),tm=setTimeout(()=>a.abort(),20000);try{const r=await fetch(API+path,{signal:a.signal});if(!r.ok)throw Error('API '+r.status);const d=await r.json();if(!Array.isArray(d))throw Error('API 응답 오류');return d}catch(e){if(i===2)throw e;await sleep(600*(i+1))}finally{clearTimeout(tm)}}}
const epoch=s=>Date.parse(s.endsWith('Z')?s:s+'Z');
const order=a=>a.sort((x,y)=>epoch(x.candle_date_time_utc)-epoch(y.candle_date_time_utc));
const dateKst=(ms)=>new Date(ms+32400000).toISOString().slice(0,10);
const kstHour=(ms)=>new Date(ms+32400000).toISOString().slice(11,16);
const dayUtc=(d,hh,mm)=>Date.parse(d+'T00:00:00Z')+(hh*60+mm-540)*60000;
const blank=()=>({v:36,plan:40,cohortChecked:[],done:[],candidates:[],checked:[],samples:[],completed:false,created:Date.now()});
function read(){try{const x=JSON.parse(localStorage.getItem(KEY)||'null');if(x?.v!==36||!Array.isArray(x.samples)||!Array.isArray(x.done)||!Array.isArray(x.checked))return blank();if(!Array.isArray(x.cohortChecked))x.cohortChecked=[];if(x.plan!==40){x.plan=40;x.completed=false}return x}catch(e){return blank()}}
function save(d){try{localStorage.setItem(KEY,JSON.stringify(d));return true}catch(e){$('progress').textContent='저장 공간이 부족합니다. 학습 데이터 저장 실패';return false}}
function stats(d){$('scanned').textContent=d.done.length;$('samples').textContent=d.samples.filter(x=>x.y===1).length;$('negatives').textContent=d.samples.filter(x=>x.y===0).length;$('compared').textContent='0'}
function vector(rows){
 if(rows.length<97)return null;const a=rows.slice(-97),first=epoch(a[0].candle_date_time_utc);
 if(a.some((c,i)=>epoch(c.candle_date_time_utc)!==first+i*STEP))return null;
 const price=i=>Number(a.at(i).trade_price),mean=x=>x.reduce((s,c)=>s+Number(c.candle_acc_trade_price||0),0)/x.length;
 const base=mean(a.slice(0,80)),vol4=mean(a.slice(-4)),vol12=mean(a.slice(-12)),high=Math.max(...a.slice(-24).map(c=>Number(c.high_price))),low=Math.min(...a.slice(-24).map(c=>Number(c.low_price)));
 const buys=a.slice(-12).filter(c=>Number(c.trade_price)>Number(c.opening_price)).reduce((s,c)=>s+Number(c.candle_acc_trade_price||0),0),total=a.slice(-12).reduce((s,c)=>s+Number(c.candle_acc_trade_price||0),0);
 const f=[100*(price(-1)/price(-5)-1),100*(price(-1)/price(-13)-1),100*(price(-1)/price(-25)-1),100*(price(-1)/price(0)-1),Math.log1p(vol4/Math.max(base,1)),Math.log1p(vol12/Math.max(base,1)),100*(high/Math.max(low,1e-10)-1),100*(price(-1)/high-1),total?buys/total:.5];
 return f.every(Number.isFinite)?f:null;
}
const scales=[2,4,7,15,.7,.7,8,6,.3];
const dist=(a,b)=>Math.sqrt(a.reduce((s,v,i)=>s+Math.min(25,((v-b[i])/scales[i])**2),0)/a.length);
async function marketData(){if(!markets.length)markets=(await get('/market/all?isDetails=false')).filter(m=>m.market.startsWith('KRW-'));const t=[];for(let i=0;i<markets.length;i+=65)t.push(...await get('/ticker?markets='+encodeURIComponent(markets.slice(i,i+65).map(x=>x.market).join(','))));tickers=t.map(t=>({...t,name:markets.find(m=>m.market===t.market)?.korean_name||t.market}));$('status').textContent='API 연결'}
async function daily(market){let to='',map=new Map();for(let i=0;i<4;i++){const a=await get('/candles/days?market='+encodeURIComponent(market)+'&count=200'+(to?'&to='+encodeURIComponent(to):''));if(!a.length)break;for(const c of a)map.set(c.candle_date_time_utc,c);const next=a.at(-1).candle_date_time_utc+'Z';if(next===to||a.length<200)break;to=next;await sleep(150)}const cutoff=Date.now()-731*86400000;return [...map.values()].filter(c=>epoch(c.candle_date_time_utc)>cutoff&&epoch(c.candle_date_time_utc)<Date.now()-86400000)}
async function bars(market,date){
 // Retrieve 15m candles before 10:15 KST, including 08:30 observation and future outcome.
 const end=new Date(dayUtc(date,10,15)).toISOString(),m=new Map();let cursor=end;
 for(let i=0;i<3;i++){const a=await get('/candles/minutes/15?market='+encodeURIComponent(market)+'&count=200&to='+encodeURIComponent(cursor));if(!a.length)break;for(const c of a)m.set(c.candle_date_time_utc,c);const next=a.at(-1).candle_date_time_utc+'Z';if(next===cursor||a.length<200)break;cursor=next;await sleep(140)}
 return order([...m.values()]);
}
function sample(market,name,date,a){
 const cutoff=dayUtc(date,8,30),end=dayUtc(date,10,0);
 const prev=a.filter(c=>epoch(c.candle_date_time_utc)<cutoff);
 // 08:15 candle is last fully closed at 08:30.
 if(!prev.length||epoch(prev.at(-1).candle_date_time_utc)!==cutoff-STEP)return null;
 const f=vector(prev);if(!f)return null;
 const future=a.filter(c=>epoch(c.candle_date_time_utc)>=cutoff&&epoch(c.candle_date_time_utc)<end);
 if(future.length!==6||future.some((c,i)=>epoch(c.candle_date_time_utc)!==cutoff+i*STEP))return null;
 const entry=Number(prev.at(-1).trade_price),peak=Math.max(...future.map(c=>Number(c.high_price))),trough=Math.min(...future.map(c=>Number(c.low_price)));
 const gain=100*(peak/entry-1),drawdown=100*(trough/entry-1);
 const peakCandle=future.find(c=>Number(c.high_price)===peak);
 const startCandle=future.find(c=>Number(c.high_price)>=entry*1.03);
 const rise=future.map(c=>({time:kstHour(epoch(c.candle_date_time_utc)),closePct:100*(Number(c.trade_price)/entry-1),highPct:100*(Number(c.high_price)/entry-1),turnover:Number(c.candle_acc_trade_price||0)}));
 return {market,name,date,f,y:gain>=10?1:0,gain,drawdown,peakTime:kstHour(epoch(peakCandle.candle_date_time_utc)),onsetTime:startCandle?kstHour(epoch(startCandle.candle_date_time_utc)):null,rise};
}
function split(d){const a=d.samples.slice().sort((x,y)=>x.date.localeCompare(y.date));const dates=[...new Set(a.map(x=>x.date))];const boundary=dates[Math.floor(dates.length*.8)]||'9999';return {train:a.filter(x=>x.date<boundary),test:a.filter(x=>x.date>=boundary),boundary}}
function classify(f,train){
 if(train.length<20)return null;
 const pos=train.filter(x=>x.y===1),neg=train.filter(x=>x.y===0);
 if(pos.length<5||neg.length<10)return null;
 // Balanced class neighborhoods prevent the majority class from overwhelming rare spikes.
 const k=7,neighbors=(arr)=>arr.map(x=>({x,d:dist(f,x.f)})).sort((a,b)=>a.d-b.d).slice(0,k);
 const p=neighbors(pos),n=neighbors(neg),weight=z=>1/(.25+z.d)**2;
 const density=a=>a.reduce((s,z)=>s+weight(z),0)/a.length;
 const pd=density(p),nd=density(n);
 const raw=pd/(pd+nd);
 const nearest=[...p,...n].sort((a,b)=>a.d-b.d)[0];
 return Number.isFinite(raw)?{raw,nearest,n:p.length+n.length}:null;
}
function validation(d){
 const {train,test,boundary}=split(d);
 const scored=test.map(x=>({x,p:classify(x.f,train)})).filter(x=>x.p);
 const byDay=new Map();
 for(const z of scored){if(!byDay.has(z.x.date))byDay.set(z.x.date,[]);byDay.get(z.x.date).push(z)}
 let picks=0,hits=0,baseHits=0,eligible=0,days=0,positiveDays=0;
 // Only days with at least 5 observed assets qualify as a TOP5 comparison.
 for(const rows of byDay.values()){
  if(rows.length<5)continue;
  days++;eligible+=rows.length;baseHits+=rows.filter(z=>z.x.y).length;
  if(rows.some(z=>z.x.y))positiveDays++;
  for(const z of rows.sort((a,b)=>b.p.raw-a.p.raw).slice(0,5)){picks++;hits+=z.x.y}
 }
 const precision=picks?100*hits/picks:null,base=eligible?100*baseHits/eligible:null;
 const lift=precision!==null&&base>0?precision/base:null;
 const valid=train.filter(x=>x.y).length>=10&&test.filter(x=>x.y).length>=5&&days>=10&&picks>=50;
 $('validation').textContent='시간순 분리 검증 · 학습 '+train.length+'건 / 미래 검증 '+test.length+'건 (경계 '+boundary+') · 비교 가능 날짜 '+days+'일 · TOP5 적중 '+hits+'/'+picks+(precision===null?' (검증 불가)':' = '+precision.toFixed(1)+'%')+(base===null?'':' · 동일 날짜 전체 급등 '+base.toFixed(1)+'%')+(lift===null?'':' · 기준 대비 '+lift.toFixed(2)+'배')+(valid?' · 검증 표본 기준 충족':' · 검증 표본 부족');
 if(!days)$('validation').textContent+=' · 하루 5종목 이상 과거 관측이 필요합니다';
 return {train,test,scored,precision,base,lift,valid,days};
}
async function learn(d){
 const chosen=tickers.filter(t=>Number(t.acc_trade_price_24h)>1e8).sort((a,b)=>b.acc_trade_price_24h-a.acc_trade_price_24h).slice(0,LIMIT);
 for(const t of chosen){if(d.done.includes(t.market))continue;$('progress').textContent='2년 일봉 조사 '+(d.done.length+1)+'/'+chosen.length+' · '+t.market;
 try{const a=await daily(t.market);for(const c of a){const v=Number(c.high_price)/Number(c.opening_price),day=c.candle_date_time_utc.slice(0,10);if(v>=1.02&&Number(c.candle_acc_trade_price)>5e7){for(const date of [day,new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10)]){if(dayUtc(date,10,0)<Date.now()-86400000)d.candidates.push({market:t.market,name:t.name,date,kind:'event'})}}}d.done.push(t.market);save(d);stats(d)}catch(e){$('progress').textContent='일봉 실패 '+t.market+': '+e.message}await sleep(130)}
 const unique=[...new Map(d.candidates.map(x=>[x.market+'|'+x.date,x])).values()].sort((a,b)=>a.date.localeCompare(b.date));
 // Stratified historical dates: older and newer, positive candidates and low-volatility controls.
 const positive=[],perCoin=new Map();for(const e of unique){const n=perCoin.get(e.market)||0;if(n>=22)continue;positive.push(e);perCoin.set(e.market,n+1);if(positive.length>=EVENT_LIMIT)break}
 const controls=[];const dates=[...new Set(unique.map(x=>x.date))];for(let i=0;i<dates.length*2&&controls.length<CONTROL_LIMIT;i++){const m=chosen[(i*7)%chosen.length];if(!m)break;const e={market:m.market,name:m.name,date:dates[i%dates.length],kind:'control'};if(!positive.some(p=>p.market===e.market&&p.date===e.date))controls.push(e)}
 const all=[...positive,...controls];
 for(let i=0;i<all.length;i++){const e=all[i],id=e.market+'|'+e.date;if(d.checked.includes(id))continue;$('progress').textContent='08:30 기준 학습 '+(i+1)+'/'+all.length+' · '+e.market+' · '+e.date;
 try{const s=sample(e.market,e.name,e.date,await bars(e.market,e.date));if(s){const old=d.samples.findIndex(x=>x.market===s.market&&x.date===s.date);if(old>=0)d.samples[old]=s;else d.samples.push(s)}d.checked.push(id);save(d);stats(d)}catch(err){$('progress').textContent='분봉 오류 '+e.market+': '+err.message}await sleep(130)}
 // Cohort backtest: observe multiple assets on the SAME historical morning.
 // Stratify candidate dates over time and select assets without inspecting intraday outcomes.
 const distinct=[...new Set(unique.map(e=>e.date))].sort();
 const cohortDates=[];
 const slots=Math.min(24,distinct.length);
 for(let i=0;i<slots;i++){const date=distinct[Math.floor(i*(distinct.length-1)/Math.max(1,slots-1))];if(!cohortDates.includes(date))cohortDates.push(date)}
 const cohortMarkets=chosen.slice(0,20);
 const total=cohortDates.length*cohortMarkets.length;
 let completed=0;
 for(const date of cohortDates){
  for(const t of cohortMarkets){
   const id=t.market+'|'+date;completed++;
   if(d.cohortChecked.includes(id)||d.checked.includes(id))continue;
   $('progress').textContent='동일 날짜 교차검증 자료 '+completed+'/'+total+' · '+date+' · '+t.market;
   try{
    const s=sample(t.market,t.name,date,await bars(t.market,date));
    if(s){const old=d.samples.findIndex(x=>x.market===s.market&&x.date===s.date);if(old>=0)d.samples[old]=s;else d.samples.push(s)}
    d.cohortChecked.push(id);save(d);stats(d);
   }catch(err){$('progress').textContent='교차검증 조회 오류 '+t.market+': '+err.message}
   await sleep(160);
  }
 }
 d.completed=chosen.every(t=>d.done.includes(t.market))&&all.every(e=>d.checked.includes(e.market+'|'+e.date))&&cohortDates.every(date=>cohortMarkets.every(t=>d.cohortChecked.includes(t.market+'|'+date)||d.checked.includes(t.market+'|'+date)));
 save(d);
}
async function currentVector(market){const a=await get('/candles/minutes/15?market='+encodeURIComponent(market)+'&count=120');const limit=Math.floor(Date.now()/STEP)*STEP;return vector(order(a.filter(c=>epoch(c.candle_date_time_utc)<limit)))}
async function rank(d){
 const v=validation(d),train=d.samples;if(train.filter(x=>x.y===1).length<10||train.filter(x=>x.y===0).length<20){$('results').innerHTML='<p>학습용 양성·음성 표본이 충분하지 않습니다. TOP 5를 생성하지 않습니다.</p>';return}
 const selected=tickers.filter(t=>Number(t.acc_trade_price_24h)>1e8&&t.signed_change_rate<.1&&t.signed_change_rate>-.15).sort((a,b)=>b.acc_trade_price_24h-a.acc_trade_price_24h).slice(0,45);
 const rows=[];for(let i=0;i<selected.length;i++){const t=selected[i];$('progress').textContent='실시간 비교 '+(i+1)+'/'+selected.length+' · '+t.market;try{const f=await currentVector(t.market),p=f&&classify(f,train);if(p)rows.push({t,f,p})}catch(e){}if(i%5===0)await sleep(100)}
 rows.sort((a,b)=>b.p.raw-a.p.raw);$('compared').textContent=rows.length;
 const inWindow=kstHour(Date.now())>='08:30'&&kstHour(Date.now())<'10:00';
 $('results').innerHTML='<p>'+(inWindow?'오전 관찰 구간 ·':'관찰 시간대 밖 ·')+' 유사 사례 기반 상대 순위이며 검증된 상승 확률이 아닙니다. '+(v.valid?'시간순 검증 표본 기준 통과':'검증 표본이 부족하여 실험용 순위만 표시')+'</p>'+rows.slice(0,5).map((r,i)=>'<article class="item"><span class="score">패턴 점수 '+Math.round(r.p.raw*100)+'/100</span><h3>'+(i+1)+'. '+esc(r.t.name)+' <small>'+esc(r.t.market)+'</small></h3><p>현재가 '+Number(r.t.trade_price).toLocaleString('ko-KR',{maximumFractionDigits:8})+'원 · 24시간 '+(r.t.signed_change_rate*100).toFixed(2)+'%</p><p>1시간 '+r.f[0].toFixed(2)+'% · 3시간 '+r.f[1].toFixed(2)+'% · 거래대금 변화 '+(Math.expm1(r.f[4])).toFixed(2)+'배</p><p>가장 가까운 과거 사례 '+esc(r.p.nearest.x.market)+' / '+esc(r.p.nearest.x.date)+' / 실제 최고 '+r.p.nearest.x.gain.toFixed(1)+'%'+(r.p.nearest.x.peakTime?' / 최고점 '+r.p.nearest.x.peakTime:'')+'</p></article>').join('');
 $('progress').textContent='학습 '+d.samples.length+'건 · 성공 '+d.samples.filter(x=>x.y).length+'건 · 실패 '+d.samples.filter(x=>!x.y).length+'건 · 현재 비교 '+rows.length+'종';
}
async function run(train){if(busy)return;busy=true;for(const x of ['start','refresh','reset'])$(x).disabled=true;try{await marketData();const d=read();stats(d);if(train&&!d.completed)await learn(d);await rank(d)}catch(e){$('progress').textContent='오류: '+e.message}finally{busy=false;for(const x of ['start','refresh','reset'])$(x).disabled=false}}
$('start').onclick=()=>run(true);$('refresh').onclick=()=>run(false);
$('reset').onclick=()=>{if(!confirm('v36 학습 데이터 전체를 삭제할까요?'))return;localStorage.removeItem(KEY);stats(blank());$('validation').textContent='검증 대기';$('results').innerHTML='<p>학습 초기화 완료</p>'};
const d=read();stats(d);if(d.samples.length)validation(d);$('status').textContent='실행 대기';
})();