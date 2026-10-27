'use strict';
/* v53: server results only; all quotation requests run on the server. */
(()=>{
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let busy=false,timer=null;
const stamp=ms=>new Date(ms).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
function card(r){const f=r.signal.f;return '<article class="item"><h3>'+esc(r.name)+' <small>'+esc(r.market)+'</small></h3><p>신호 점수 '+f.score.toFixed(0)+'/100 · 성공 확률 아님</p><p>분석 기준가 '+f.price.toLocaleString('ko-KR',{maximumFractionDigits:8})+'원 · 최근 15분 '+f.rise.toFixed(2)+'%</p><p>선행 10분 거래대금 '+f.setupRatio.toFixed(2)+'배 → 최근 5분 '+f.triggerRatio.toFixed(2)+'배 · 증가 지속 '+f.persistence+'/10봉</p><p>'+esc(r.signal.reason)+'</p><small>닫힌 봉 기준 '+stamp(r.cutoff)+' · 확인 '+stamp(r.checkedAt)+'</small></article>';}
function render(rows,counts,cutoff,errors){
 const sections=[['watch','조기 관심 · 돌파 전'],['confirmed','돌파 확인 · 선행 흔적 동반']];
 $('results').innerHTML='<p>동일 기준 시각 '+stamp(cutoff)+' · 각 단계 최대 5개. 규칙은 검증 전 연구 가설이며 점수는 확률이 아닙니다.</p>'+sections.map(([stage,label])=>{
 const group=rows.filter(r=>r.signal.stage===stage).sort((a,b)=>b.signal.f.score-a.signal.f.score);
 return '<h3>'+label+' · '+group.length+'종목</h3>'+(group.length?group.slice(0,5).map(card).join(''):'<p>조건을 충족한 종목이 없습니다.</p>');
 }).join('')+'<p>진단: 정상 분석 '+counts.valid+' · 연속 봉 부족 '+counts.missing+' · 거래대금 부족 '+counts.illiquid+' · 이미 상승 '+counts.extended+' · 순서 조건 미달 '+counts.quiet+' · API 오류 '+errors+'종목</p>';
}
const SERVER_URL='https://api.github.com/repos/hnoni777/upbit-signal-lab/contents/data/server-state.json?ref=server-data';
let lastServer=null;
function serverPerformance(state){
 const lines=['<strong>서버가 누적 기록한 신호 후 30분 결과</strong>'];
 for(const [stage,label] of [['watch','조기 관심'],['confirmed','돌파 확인']]){
  const stats=state.totals[stage],pending=state.history.filter(r=>r.stage===stage&&!r.outcome&&!r.expired).length;
  lines.push('<p>'+label+' · 평가 '+stats.evaluated+'건 · 목표 도달 '+stats.target+'건 · 손절선 먼저 '+stats.stop+'건 · 순서 불명 '+stats.ambiguous+'건 · 시간 종료 '+stats.timeout+'건'+(stats.evaluated?' · 관측 적중률 '+(100*stats.target/stats.evaluated).toFixed(1)+'%':'')+' · 대기 '+pending+'건 · 자료 누락 '+stats.missing+'건</p>');
 }
 lines.push('<p>서버 분석 완료 뒤 다음 1분봉 시가를 가상 진입으로 관찰합니다. 30분 이내 비용 가정 0.3%를 뺀 +3% 목표 / 가격 -2% 손절선 순서를 평가합니다. 실제 매매나 사용자가 화면을 연 시점의 수익률이 아닙니다. 순서 불명은 성공에서 제외합니다.</p>');
 $('forward').innerHTML=lines.join('');
}
function paintServer(state){
 if(!state.snapshot){$('status').textContent='서버 첫 분석 대기';$('progress').textContent='서버가 첫 전체 시장 분석을 진행합니다. 화면을 닫아도 작업은 계속됩니다.';return;}
 const snapshot=state.snapshot,age=Date.now()-snapshot.completedAt,delayed=age>10*60000||snapshot.stale;
 render(snapshot.candidates,snapshot.counts,snapshot.cutoff,snapshot.counts.errors);
 $('scanned').textContent=snapshot.counts.requested;$('compared').textContent=snapshot.counts.valid;
 $('samples').textContent=snapshot.candidates.filter(r=>r.signal.stage==='watch').length;
 $('negatives').textContent=snapshot.candidates.filter(r=>r.signal.stage==='confirmed').length;
 $('status').textContent=delayed?'서버 결과 지연 · 시각 확인':snapshot.counts.errors?'서버 감시 · 일부 조회 실패':'서버 감시 결과';
 $('progress').textContent='서버 분석 완료 '+stamp(snapshot.completedAt)+' · 봉 기준 '+stamp(snapshot.cutoff)+' · '+snapshot.counts.requested+'종목 요청 / '+snapshot.counts.valid+'종목 유효 / 오류 '+snapshot.counts.errors+'종목 · 서버 누적 '+state.runCount+'회 · 5분 간격 예약(실행 지연 가능)'+(delayed?' · 오래된 결과입니다. 현재 진입 신호로 보지 마세요.':'')+' · 이 화면 갱신 '+stamp(Date.now());
 $('validation').textContent='휴대폰 화면과 관계없이 서버가 분석·기록합니다. 예약 실행은 정각을 보장하지 않으며 신호의 예측 성능은 아직 검증되지 않았습니다.';
 serverPerformance(state);
}
async function loadServer(){
 if(busy)return;busy=true;clearTimeout(timer);timer=null;
 try{
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  let response;try{response=await fetch(SERVER_URL+'&t='+Math.floor(Date.now()/60000),{cache:'no-store',signal:controller.signal});}finally{clearTimeout(timeout);}
  if(!response.ok)throw Error('결과 조회 '+response.status);
  const payload=await response.json();
  const state=payload.schema===52?payload:JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.content.replace(/\s/g,'')),c=>c.charCodeAt(0))));
  if(state.schema!==52||!state.totals||!Array.isArray(state.history))throw Error('서버 결과 형식 오류');
  lastServer=state;paintServer(state);
 }catch(e){
  if(lastServer)paintServer(lastServer);
  $('status').textContent='서버 결과 조회 실패';$('progress').textContent='서버 결과를 가져오지 못했습니다: '+e.message+' · 화면의 결과가 있다면 이전 자료입니다. 서버 마지막 완료 시각을 확인해 주세요.';
 }finally{busy=false;if($('auto').checked)timer=setTimeout(loadServer,300000);}
}
$('start').onclick=loadServer;$('refresh').onclick=loadServer;
$('auto').onchange=()=>{clearTimeout(timer);timer=null;if($('auto').checked&&!busy)loadServer();};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!busy)loadServer();});
$('status').textContent='서버 결과 연결 중';
loadServer();
})();
