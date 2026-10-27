'use strict';
/* v51: causal minute-sequence hypotheses and local forward observation. */
(()=>{
const API='https://upbit-signal-proxy.parkdam6.workers.dev/v1',KEY='usl-sequence-v51-observations',S=window.SequenceSignal;
const $=id=>document.getElementById(id),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let busy=false,timer=null,history=[],storageOK=true;
let requestQueue=Promise.resolve();
async function pace(){requestQueue=requestQueue.then(()=>sleep(160));await requestQueue;}
try{const raw=JSON.parse(localStorage.getItem(KEY)||'[]');history=Array.isArray(raw)?raw.filter(r=>r.version===51&&typeof r.market==='string'&&Number.isFinite(r.cutoff)&&['watch','confirmed'].includes(r.stage)):[];}catch(e){storageOK=false;}
function save(){try{localStorage.setItem(KEY,JSON.stringify(history));storageOK=true;}catch(e){storageOK=false;}}
async function get(path){
 for(let i=0;i<3;i++){
  await pace();
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{const r=await fetch(API+path,{signal:controller.signal,cache:'no-store'});if(!r.ok)throw Error('API '+r.status);const rows=await r.json();if(!Array.isArray(rows))throw Error('배열 응답 없음');return rows;}
  catch(e){if(i===2)throw e;await sleep(800*(i+1));}finally{clearTimeout(timeout);}
 }
}
const stamp=ms=>new Date(ms).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
function settle(market,rows,cutoff){
 for(const r of history.filter(r=>r.market===market&&!r.outcome&&!r.expired&&r.entryCutoff+30*60000<=cutoff)){
  const result=S.outcome(rows,r.entryCutoff,cutoff);
  if(result)r.outcome=result;
  else r.expired=true; // Missing history is never a loss or a success.
 }
}
function remember(market,name,signal,cutoff){
 if(!['watch','confirmed'].includes(signal.stage))return;
 // Separate stages, one observation per coin/stage per 30 minutes.
 if(history.some(r=>r.market===market&&r.stage===signal.stage&&Math.abs(cutoff-r.cutoff)<30*60000))return;
 history.push({version:51,market,name,stage:signal.stage,cutoff,entryCutoff:Math.ceil(Date.now()/60000)*60000,observedAt:Date.now(),score:signal.f.score,referencePrice:signal.f.price});
 // Preserve pending observations; bound storage using old resolved records first.
 if(history.length>1000){const i=history.findIndex(r=>r.outcome||r.expired);if(i>=0)history.splice(i,1);}
}
function performance(){
 const lines=['<strong>이 기기에서 기록한 신호 후 30분 결과</strong>'];
 for(const [stage,label] of [['watch','조기 관심'],['confirmed','돌파 확인']]){
  const records=history.filter(r=>r.stage===stage),done=records.filter(r=>r.outcome),hits=done.filter(r=>r.outcome.result==='target').length;
  const losses=done.filter(r=>r.outcome.result==='stop').length,ambiguous=done.filter(r=>r.outcome.result==='ambiguous').length;
  const expired=records.filter(r=>r.expired).length,pending=records.length-done.length-expired;
  lines.push('<p>'+label+' · 평가 '+done.length+'건 · 목표 도달 '+hits+'건 · 손절선 먼저 '+losses+'건 · 순서 불명 '+ambiguous+'건 · 시간 종료 '+done.filter(r=>r.outcome.result==='timeout').length+'건'+(done.length?' · 관측 적중률 '+(100*hits/done.length).toFixed(1)+'%':'')+' · 대기 '+pending+'건 · 자료 누락 '+expired+'건</p>');
 }
 lines.push('<p>각 신호가 화면에 표시된 뒤 다음 1분봉 시가를 진입 기준으로, 30분 이내 비용 가정 0.3%를 뺀 +3% 목표 / -2% 손절선 도달 순서를 관찰합니다. 같은 봉에 둘 다 닿으면 순서 불명으로 세며 성공에 포함하지 않습니다. 실제 매매 수익률·상승 확률이 아닙니다.</p>');
 if(!storageOK)lines.push('<p>기기 저장 실패: 기록이 유지되지 않을 수 있습니다.</p>');
 $('forward').innerHTML=lines.join('');
}
function card(r){const f=r.signal.f;return '<article class="item"><h3>'+esc(r.name)+' <small>'+esc(r.market)+'</small></h3><p>신호 점수 '+f.score.toFixed(0)+'/100 · 성공 확률 아님</p><p>분석 기준가 '+f.price.toLocaleString('ko-KR',{maximumFractionDigits:8})+'원 · 최근 15분 '+f.rise.toFixed(2)+'%</p><p>선행 10분 거래대금 '+f.setupRatio.toFixed(2)+'배 → 최근 5분 '+f.triggerRatio.toFixed(2)+'배 · 증가 지속 '+f.persistence+'/10봉</p><p>'+esc(r.signal.reason)+'</p><small>닫힌 봉 기준 '+stamp(r.cutoff)+' · 확인 '+stamp(r.checkedAt)+'</small></article>';}
function render(rows,counts,cutoff,errors){
 const sections=[['watch','조기 관심 · 돌파 전'],['confirmed','돌파 확인 · 선행 흔적 동반']];
 $('results').innerHTML='<p>동일 기준 시각 '+stamp(cutoff)+' · 각 단계 최대 5개. 규칙은 검증 전 연구 가설이며 점수는 확률이 아닙니다.</p>'+sections.map(([stage,label])=>{
 const group=rows.filter(r=>r.signal.stage===stage).sort((a,b)=>b.signal.f.score-a.signal.f.score);
 return '<h3>'+label+' · '+group.length+'종목</h3>'+(group.length?group.slice(0,5).map(card).join(''):'<p>조건을 충족한 종목이 없습니다.</p>');
 }).join('')+'<p>진단: 정상 분석 '+counts.valid+' · 연속 봉 부족 '+counts.missing+' · 거래대금 부족 '+counts.illiquid+' · 이미 상승 '+counts.extended+' · 순서 조건 미달 '+counts.quiet+' · API 오류 '+errors+'종목</p>';
}
async function run(){
 if(busy)return;busy=true;clearTimeout(timer);timer=null;
 for(const id of ['start','refresh','reset'])$(id).disabled=true;
 const cutoff=Math.floor(Date.now()/60000)*60000;
 const counts={valid:0,missing:0,illiquid:0,extended:0,quiet:0};let errors=0;const signals=[];
 $('status').textContent='전체 원화마켓 분석 중';$('results').innerHTML='<p>새 분석 진행 중 · 이전 후보는 표시하지 않습니다.</p>';
 try{
  const markets=(await get('/market/all?isDetails=false')).filter(m=>m.market.startsWith('KRW-'));
  $('scanned').textContent=markets.length;
  // No market-cap or top-60 preselection: every current KRW pair is requested.
  let nextIndex=0;
  async function scanWorker(){while(nextIndex<markets.length){
   const i=nextIndex++,m=markets[i];$('progress').textContent='1분봉 순서 분석 '+(i+1)+'/'+markets.length+' · '+m.market;
   try{
    const bars=await get('/candles/minutes/1?market='+encodeURIComponent(m.market)+'&count=200&to='+encodeURIComponent(new Date(cutoff).toISOString()));
    settle(m.market,bars,cutoff);
    const signal=S.detect(bars,cutoff);
    if(signal.stage==='missing'){counts.missing++;continue;}
    counts.valid++;
    if(['illiquid','extended','quiet'].includes(signal.stage))counts[signal.stage]++;
    else{
     const row={market:m.market,name:m.korean_name||m.market,signal,cutoff,checkedAt:Date.now()};
     signals.push(row);
     // An old snapshot cannot become a newly observed early signal.
     if(Date.now()-cutoff<=3*60000)remember(row.market,row.name,signal,cutoff);
    }
   }catch(e){errors++;}finally{await sleep(180);}
   $('compared').textContent=counts.valid;
  }}
  await Promise.all(Array.from({length:Math.min(3,markets.length)},()=>scanWorker()));
  const stale=Date.now()-cutoff>3*60000;
  // Keep the observed candidates for inspection but label stale runs explicitly.
  const displayedAt=Date.now();
  for(const r of history.filter(r=>r.cutoff===cutoff&&!r.outcome&&!r.expired))r.entryCutoff=Math.ceil(displayedAt/60000)*60000;
  render(signals,counts,cutoff,errors);save();performance();
  $('samples').textContent=signals.filter(r=>r.signal.stage==='watch').length;
  $('negatives').textContent=signals.filter(r=>r.signal.stage==='confirmed').length;
  $('validation').textContent='v51 순서 탐지: 과거 15분봉 모델과 분리 · 새 규칙의 과거 적중률은 아직 검증하지 않았습니다.';
  $('status').textContent=stale?'분석 지연 · 오래된 기준 시각':errors?'일부 조회 실패':'분석 완료';
  $('progress').textContent='완료 '+stamp(Date.now())+' · 기준 '+stamp(cutoff)+' · '+markets.length+'종목 요청 / '+counts.valid+'종목 유효 / 오류 '+errors+'종목'+(stale?' · 기준 시각이 3분 이상 지나 신규 기록을 제한했습니다.':'')+' · 자동 갱신 '+($('auto').checked?'켜짐':'꺼짐');
 }catch(e){$('status').textContent='분석 실패';$('progress').textContent='조회 오류: '+e.message;}
 finally{
  save();performance();busy=false;for(const id of ['start','refresh','reset'])$(id).disabled=false;
  if($('auto').checked)timer=setTimeout(run,60000);
 }
}
$('start').onclick=run;$('refresh').onclick=run;
$('reset').onclick=()=>{if(!confirm('이 기기에 기록한 v51 신호 관찰 결과를 삭제할까요?'))return;history=[];save();performance();};
$('auto').onchange=()=>{clearTimeout(timer);timer=null;if($('auto').checked&&!busy)run();};
$('status').textContent='분석 대기';performance();
})();
