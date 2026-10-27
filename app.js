'use strict';
/* v54: server results only; all quotation requests run on the server. */
(()=>{
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let busy=false,timer=null;
const stamp=ms=>new Date(ms).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
const labels={maintaining:'흐름 유지',pullback:'눌림 관찰',watch:'초기 흔적 관찰',weakening:'신호 약화'};
const num=(v,n=2)=>Number.isFinite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:n}):'자료 없음';
function spark(values){
 if(!Array.isArray(values)||values.length<2)return '';
 const min=Math.min(...values),range=Math.max(...values)-min||1;
 const points=values.map((v,i)=>(i*240/(values.length-1)).toFixed(1)+','+(49-(v-min)*44/range).toFixed(1)).join(' ');
 return '<svg viewBox="0 0 240 54" role="img" aria-label="최근 60분 종가 흐름" style="width:100%;height:65px"><polyline points="'+points+'" fill="none" stroke="#70e7c6" stroke-width="1.6"/></svg>';
}
function card(r){
 const f=r.signal.f,d=r.detail;
 if(!d)return '<article class="item"><h3>'+esc(r.name)+'</h3><p>이전 버전 결과 · 상세 분석을 기다리는 중입니다.</p></article>';
 const risk=d.flags.length?'<p class="risk">'+d.flags.map(esc).join(' · ')+'</p>':'';
 return '<article class="item"><span class="phase '+d.status+'">'+labels[d.status]+'</span><h3>'+esc(r.name)+' <small>'+esc(r.market)+'</small></h3><p>분석 기준가 '+num(d.price,8)+'원 · 최근 15분 '+num(d.returns[15])+'%</p>'+spark(d.spark)+
 '<p>최근 1분 '+num(d.returns[1])+'% · 3분 '+num(d.returns[3])+'% · 5분 '+num(d.returns[5])+'%</p>'+
 '<p>거래 증가 '+(d.continuation?'지속':'둔화')+' · 최근 3분 '+num(d.recentRatio)+'배 · 실제 거래 발생 '+d.active15+'/15분</p>'+
 '<p>직전 고점 대비 '+num(d.pullback)+'% · 단기 추세 '+(d.aboveTrend?'상승 정렬':'미정렬')+' · 돌파 구간 '+(d.hold?'유지 관찰':'유지 미확인')+'</p>'+risk+
 (r.refreshFailed?'<p class="risk">후보 재조회 실패 · 이전 봉 기준으로 표시합니다.</p>':'')+
 (r.followUp?'<p class="risk">이전 신호 추적: 현재 최초 탐지 조건을 유지하지 못합니다. 새 신호로 집계하지 않습니다.</p>':'')+
 '<details><summary>가격 구간·시장 비교 자세히</summary><p>최근 10분 저점 '+num(d.support,8)+'원 · 최근 20분 고점 '+num(d.resistance,8)+'원</p><p>직전 돌파 관찰선 '+num(d.breakoutLevel,8)+'원 · 20분 거래량 가중평균 '+num(d.vwap20,8)+'원</p><p>최근 15분 BTC 대비 '+num(d.relativeBtc15)+'%p · 최근 변동폭(ATR) '+num(d.atrPct)+'%</p><p>가격 구간은 관측값이며 매수가·손절가를 제시하는 것이 아닙니다. 점수나 조건은 성공 확률이 아닙니다.</p></details><small>상세 봉 기준 '+stamp(d.cutoff)+' · 최초 관찰 '+stamp(r.firstSeen||r.cutoff)+'</small></article>';
}
function render(rows,counts,cutoff,errors){
 const sections=['maintaining','pullback','watch','weakening'];
 $('results').innerHTML='<p>전체 시장 기준 '+stamp(cutoff)+' · 후보는 더 최근의 닫힌 봉으로 재확인합니다. 각 상태 최대 5개. 고정 규칙은 검증 전이며 흐름 유지는 상승 예측이 아닙니다.</p>'+sections.map(key=>{
  const group=rows.filter(r=>(r.detail?.status||'watch')===key).sort((a,b)=>(b.detail?.quality||0)-(a.detail?.quality||0));
  return '<h3>'+labels[key]+' · '+group.length+'종목</h3>'+(group.length?group.slice(0,5).map(card).join(''):'<p>현재 이 상태의 후보가 없습니다.</p>');
 }).join('')+'<p>진단: 정상 분석 '+counts.valid+' · 봉 자료 부족 '+counts.missing+' · 거래대금 부족 '+counts.illiquid+' · 이미 상승 '+counts.extended+' · 최초 조건 미달 '+counts.quiet+' · API 오류 '+errors+'종목</p>';
}
const SERVER_URL='https://api.github.com/repos/hnoni777/upbit-signal-lab/contents/data/server-state.json?ref=server-data';
let lastServer=null,lastSeenCompletedAt=null,lastLookupAt=0,unchanged=false;
function serverPerformance(state){
 const lines=['<strong>'+(state.analysisVersion===54?'v54 상세 조건으로 새로 기록한 신호 후 30분 결과':'이전 버전의 신호 후 30분 결과')+'</strong>'];
 for(const [stage,label] of [['watch','조기 관심'],['confirmed','돌파 확인']]){
  const detailed=state.analysisVersion===54;
  const stats=(detailed?state.detailTotals:state.totals)[stage],pending=state.history.filter(r=>r.stage===stage&&(detailed?r.strategyVersion===54:!r.strategyVersion)&&!r.outcome&&!r.expired).length;
  lines.push('<p>'+label+' · 평가 '+stats.evaluated+'건 · 목표 도달 '+stats.target+'건 · 손절선 먼저 '+stats.stop+'건 · 순서 불명 '+stats.ambiguous+'건 · 시간 종료 '+stats.timeout+'건'+(stats.evaluated?' · 관측 적중률 '+(100*stats.target/stats.evaluated).toFixed(1)+'%':'')+' · 대기 '+pending+'건 · 자료 누락 '+stats.missing+'건</p>');
 }
 lines.push('<p>서버 분석 완료 뒤 다음 1분봉 시가를 가상 진입으로 관찰합니다. 30분 이내 비용 가정 0.3%를 뺀 +3% 목표 / 가격 -2% 손절선 순서를 평가합니다. 실제 매매나 사용자가 화면을 연 시점의 수익률이 아닙니다. 순서 불명은 성공에서 제외합니다.</p>');
 $('forward').innerHTML=lines.join('');
}
function paintServer(state){
 if(!state.snapshot){$('status').textContent='서버 첫 분석 대기';$('progress').textContent='서버가 첫 전체 시장 분석을 진행합니다. 화면을 닫아도 작업은 계속됩니다.';return;}
 const snapshot=state.snapshot,age=Date.now()-snapshot.completedAt,delayed=age>7*60000||snapshot.stale;
 render(snapshot.candidates,snapshot.counts,snapshot.cutoff,snapshot.counts.errors);
 $('scanned').textContent=snapshot.counts.requested;$('compared').textContent=snapshot.counts.valid;
 $('samples').textContent=snapshot.candidates.filter(r=>r.detail?.status!=='weakening').length;
 $('negatives').textContent=snapshot.candidates.filter(r=>r.detail?.status==='weakening').length;
 $('status').textContent=delayed?'서버 새 분석 지연':unchanged?'새 분석 결과 없음':snapshot.counts.errors?'서버 감시 · 일부 조회 실패':'새 서버 분석 반영';
 $('progress').textContent='서버 분석 완료 '+stamp(snapshot.completedAt)+' · 봉 기준 '+stamp(snapshot.cutoff)+' · '+snapshot.counts.requested+'종목 요청 / '+snapshot.counts.valid+'종목 유효 / 오류 '+snapshot.counts.errors+'종목 · 상세 제외 '+(snapshot.excluded||0)+'종목 / 재조회 오류 '+(snapshot.refreshErrors||0)+'종목 · 서버 누적 '+state.runCount+'회 · '+(state.lastAutonomousAt?'자동 이어실행 확인됨':state.lastScheduledAt?'예약 실행 확인됨':'자동 이어실행 확인 전')+' · 약 5분 간격 이어실행(대기열 지연 가능)'+(delayed?' · 오래된 결과입니다. 현재 진입 신호로 보지 마세요.':'')+' · 서버 자료 나이 '+Math.max(0,Math.floor(age/60000))+'분 · 조회 시각 '+stamp(lastLookupAt||Date.now())+(unchanged?' · 직전 조회와 같은 서버 결과입니다.':'' );
 $('validation').textContent='휴대폰 화면과 관계없이 서버가 분석·기록합니다. 예약 실행은 정각을 보장하지 않으며 1·3·5·15분 흐름과 후보 재확인을 함께 봅니다. 예측 성능은 아직 검증되지 않았으며 이전 버전 기록과 v54 집계를 구분합니다.';
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
  unchanged=lastSeenCompletedAt!==null&&lastSeenCompletedAt===state.completedAt;
  lastSeenCompletedAt=state.completedAt;lastLookupAt=Date.now();
  lastServer=state;paintServer(state);
 }catch(e){
  if(lastServer)paintServer(lastServer);
  $('status').textContent='서버 결과 조회 실패';$('progress').textContent='서버 결과를 가져오지 못했습니다: '+e.message+' · 화면의 결과가 있다면 이전 자료입니다. 서버 마지막 완료 시각을 확인해 주세요.';
 }finally{busy=false;if($('auto').checked)timer=setTimeout(loadServer,300000);}
}
setInterval(()=>{if(lastServer&&!document.hidden)paintServer(lastServer);},30000);
$('start').onclick=loadServer;$('refresh').onclick=loadServer;
$('auto').onchange=()=>{clearTimeout(timer);timer=null;if($('auto').checked&&!busy)loadServer();};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!busy)loadServer();});
$('status').textContent='서버 결과 확인 중';
loadServer();
})();
