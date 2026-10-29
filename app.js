'use strict';
/* v58: immediate ranking updates from completed outcomes, plus public live quotes. */
(()=>{
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let busy=false,timer=null,lastLoadFailed=false;
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
 lines.push('<p>이 집계는 전체 v54 신호의 결과이며, 위 TOP 3만의 적중률이 아닙니다. 우선 검토 선정 규칙의 수익성은 별도 검증 전입니다.</p>');
 lines.push('<p>서버 분석 완료 뒤 다음 1분봉 시가를 가상 진입으로 관찰합니다. 30분 이내 비용 가정 0.3%를 뺀 +3% 목표 / 가격 -2% 손절선 순서를 평가합니다. 실제 매매나 사용자가 화면을 연 시점의 수익률이 아닙니다. 순서 불명은 성공에서 제외합니다.</p>');
 $('forward').innerHTML=lines.join('');
}
let quoteRows=[],quoteState={connected:false,data:{},available:false};
const live=window.LiveQuotes?.create(state=>{quoteState=state;paintQuotes();});
function paintQuotes(){
 const panel=$('quotes');if(!panel)return;
 const intro='<p>업비트 공개 시세 · 화면을 보고 있을 때 TOP 3만 수신합니다. 서버 분석은 별도로 약 5분마다 갱신됩니다. 호가 잔량은 취소될 수 있으며 세력 매집이나 실제 체결을 뜻하지 않습니다.</p>';
 if(!quoteRows.length){panel.innerHTML=intro+'<p>추천 후보가 없어서 실시간 구독을 대기합니다.</p>';return;}
 panel.innerHTML=intro+'<p role="status">'+(!quoteState.available?'이 환경에서 실시간 연결을 지원하지 않습니다.':quoteState.connected?'시세 연결됨 · 항목별 자료 시각 확인':'시세 연결 대기·끊김 · 재연결 중, 현재값 확인 불가')+'</p>'+quoteRows.map(r=>{
  const q=quoteState.data[r.market]||{},t=q.ticker,b=q.book,tf=window.LiveQuotes.fresh(t,quoteState.connected),bf=window.LiveQuotes.fresh(b,quoteState.connected);
  return '<article class="item"><h3>'+esc(r.name)+' <small>'+esc(r.market)+'</small></h3><p>분석 기준 '+num(r.detail.price,8)+'원 · '+stamp(r.detail.cutoff)+'</p><p><strong>마지막 체결가 '+(t?num(t.price,8)+'원':'수신 대기')+'</strong> · '+(tf?'최신':'현재가 확인 불가·오래된 값')+'</p>'+(t?'<small>체결 '+stamp(t.tradeTime)+' · 시세 '+stamp(t.time)+'</small><p>분석 기준 대비 '+num((t.price/r.detail.price-1)*100)+'%'+(!tf?' (오래된 체결 기준)':'')+'</p>':'')+'<p>호가 '+(bf?'최신':'확인 불가·대기 또는 오래됨')+(b?' · '+stamp(b.time):'')+'</p>'+(b?'<p>최우선 매수 '+num(b.bid,8)+'원 / 매도 '+num(b.ask,8)+'원 · 간격 '+num(b.spread,4)+'%</p><p>가까운 '+b.levels.length+'단계 대기금액: 매수 '+num(b.bidKrw,0)+'원 / 매도 '+num(b.askKrw,0)+'원</p><details><summary>호가 단계별 가격·잔량</summary><table style="width:100%;font-size:12px"><thead><tr><th>매수 가격 / 수량</th><th>매도 가격 / 수량</th></tr></thead><tbody>'+b.levels.map(u=>'<tr><td>'+num(u.bid_price,8)+' / '+num(u.bid_size,4)+'</td><td>'+num(u.ask_price,8)+' / '+num(u.ask_size,4)+'</td></tr>').join('')+'</tbody></table></details>':'')+'<p class="risk">'+(!tf||!bf?'최신 가격·호가를 모두 확인하기 전에는 이 표시로 진입 판단을 하지 마세요.':'실시간 시세가 들어와도 이전 분석의 유효성이나 체결 가격을 보장하지 않습니다.')+'</p></article>';
 }).join('');
}
setInterval(()=>{if(!document.hidden)paintQuotes();},1000);
function recommendations(state){
 const result=window.CandidateRecommendations.select(state.snapshot,Date.now(),lastLoadFailed,state.learning?.champion||null);
 quoteRows=result.picks;live?.set(quoteRows.map(r=>r.market));paintQuotes();
 const intro='<p>정렬 기준: '+(state.learning?.champion?(state.learning.champion.policy==='immediate-v58'?'즉시 학습 모델 적용 · 검증 전':'기존 학습 모델'):'기존 고정 규칙')+'</p><p>단타용으로 먼저 살펴볼 후보를 최대 3개 고릅니다. 고정 조건을 비교한 결과이며, 매수 지시·성공 확률·검증된 수익률이 아닙니다.</p>';
 if(!result.picks.length){
  $('recommendations').innerHTML=intro+'<p><strong>지금은 추천 보류</strong> · '+esc(result.hold)+'</p>'+Object.entries(result.rejected).map(([reason,count])=>'<small>'+esc(reason)+' '+count+'종목</small>').join(' · ');return;
 }
 $('recommendations').innerHTML=intro+result.picks.map((r,i)=>{
  const d=r.detail;
  return '<article class="item recommendation"><span class="phase '+d.status+'">'+(i+1)+'순위 · '+labels[d.status]+'</span><h3>'+esc(r.name)+' <small>'+esc(r.market)+'</small></h3><p>왜 먼저 보는가</p><ul>'+r.recommendation.reasons.map(reason=>'<li>'+esc(reason)+'</li>').join('')+'</ul><p>최근 3분 '+num(d.returns[3])+'% · 15분 '+num(d.returns[15])+'% · BTC 대비 '+num(d.relativeBtc15)+'%p · 거래 '+num(d.recentRatio)+'배</p><p class="risk">'+r.recommendation.cautions.map(esc).join(' ')+'</p><p><strong>확인할 것:</strong> 실제 거래소의 현재 1분봉·호가에서 신호 이후 되밀리지 않았는지 확인하세요. 서버 자료와 현재 가격은 다를 수 있습니다.</p><small>상세 봉 기준 '+stamp(d.cutoff)+' · 서버 완료 '+stamp(state.snapshot.completedAt)+'</small></article>';
 }).join('');
}
function learningPanel(state){
 const l=state.learning;if(!l){$('learning').innerHTML='<p>학습 기록을 불러오는 중입니다.</p>';return;}
 const immediate=l.mode==='immediate',m=l.champion;
 const status=immediate?(l.status==='training_failed'?'학습 계산 실패 · 이전 모델 유지':m?'즉시 학습 모델 적용 중 · 검증 전':'평가 완료 기록 대기'):'이전 방식의 서버 결과 · 다음 서버 분석에서 즉시 학습으로 전환';
 $('learning').innerHTML='<p><strong>'+esc(status)+'</strong></p><p>현재 정렬: '+(m?esc(m.id):'기존 고정 규칙')+'</p><p>보관 비교 표본 '+l.observations+'건 · 누적 결과 판정 '+l.resolved+'건 · 보관 중 추천 표본 '+l.recommended+'건 / 평가 완료 '+l.recommendedEvaluated+'건</p>'+
 (m?.policy==='immediate-v58'?'<p>현재 모델 학습 표본 '+m.trainingSamples+'건 · 목표 도달 '+m.positives+'건 / 그 외 '+m.negatives+'건 · 마지막 적용 '+stamp(m.trainedAt)+'</p>':'')+
 (immediate?'<p>28일·400건 대기 없이, 새 30분 평가 결과가 확정되는 서버 분석마다 재학습해 추천 순서에 바로 반영합니다. 새 결과가 없으면 현재 모델을 유지합니다. 후보 선정 조건과 목표·손절 기준은 유지합니다.</p><p class="risk">별도 검증을 기다리지 않고 적용한 모델입니다. 수익성 개선이나 성공 확률이 입증된 것은 아니며, 새 기록에 따라 순위가 바뀔 수 있습니다.</p>':'');
}
function paintServer(state){
 if(!state.snapshot){$('status').textContent='서버 첫 분석 대기';$('progress').textContent='서버가 첫 전체 시장 분석을 진행합니다. 화면을 닫아도 작업은 계속됩니다.';return;}
 learningPanel(state);
 recommendations(state);
 const snapshot=state.snapshot,age=Date.now()-snapshot.completedAt,delayed=age>7*60000||snapshot.stale;
 render(snapshot.candidates,snapshot.counts,snapshot.cutoff,snapshot.counts.errors);
 $('scanned').textContent=snapshot.counts.requested;$('compared').textContent=snapshot.counts.valid;
 $('samples').textContent=snapshot.candidates.filter(r=>r.detail?.status!=='weakening').length;
 $('negatives').textContent=snapshot.candidates.filter(r=>r.detail?.status==='weakening').length;
 $('status').textContent=lastLoadFailed?'서버 결과 조회 실패':delayed?'서버 새 분석 지연':unchanged?'새 분석 결과 없음':snapshot.counts.errors?'서버 감시 · 일부 조회 실패':'새 서버 분석 반영';
 $('progress').textContent='서버 분석 완료 '+stamp(snapshot.completedAt)+' · 봉 기준 '+stamp(snapshot.cutoff)+' · '+snapshot.counts.requested+'종목 요청 / '+snapshot.counts.valid+'종목 유효 / 오류 '+snapshot.counts.errors+'종목 · 상세 제외 '+(snapshot.excluded||0)+'종목 / 재조회 오류 '+(snapshot.refreshErrors||0)+'종목 · 서버 누적 '+state.runCount+'회 · '+(state.lastAutonomousAt?'자동 이어실행 확인됨':state.lastScheduledAt?'예약 실행 확인됨':'자동 이어실행 확인 전')+' · 약 5분 간격 이어실행(대기열 지연 가능)'+(delayed?' · 오래된 결과입니다. 현재 진입 신호로 보지 마세요.':'')+' · 서버 자료 나이 '+Math.max(0,Math.floor(age/60000))+'분 · 조회 시각 '+stamp(lastLookupAt||Date.now())+(unchanged?' · 직전 조회와 같은 서버 결과입니다.':'' );
 $('validation').textContent='휴대폰 화면과 관계없이 서버가 분석·기록합니다. 예약 실행은 정각을 보장하지 않으며 1·3·5·15분 흐름과 후보 재확인을 함께 봅니다. 예측 성능은 아직 검증되지 않았으며 이전 버전 기록과 v54 집계를 구분합니다.';
 serverPerformance(state);
}
async function loadServer(){
 if(busy)return;busy=true;clearTimeout(timer);timer=null;
 try{
  async function fetchState(url){
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
   try{
    const response=await fetch(url,{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error('결과 조회 '+response.status);
    const payload=await response.json();
    const data=payload.schema===52?payload:JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.content.replace(/\s/g,'')),c=>c.charCodeAt(0))));
    if(data.schema!==52||!data.totals||!Array.isArray(data.history))throw Error('서버 결과 형식 오류');
    return data;
   }finally{clearTimeout(timeout);}
  }
  const raw='https://raw.githubusercontent.com/hnoni777/upbit-signal-lab/server-data/data/server-state.json?t='+Date.now();
  let state;
  try{
   state=await fetchState(raw);
   // Old edge-cache data may be checked against the current GitHub file API.
   if(Date.now()-state.completedAt>7*60000){try{const current=await fetchState(SERVER_URL+'&t='+Date.now());if(current.completedAt>state.completedAt)state=current;}catch(e){}}
  }catch(rawError){state=await fetchState(SERVER_URL+'&t='+Date.now());}
  // Never replace an already-seen snapshot with an older cached copy.
  if(lastServer?.completedAt>state.completedAt)state=lastServer;
  unchanged=lastSeenCompletedAt!==null&&lastSeenCompletedAt===state.completedAt;
  lastSeenCompletedAt=state.completedAt;lastLookupAt=Date.now();
  lastLoadFailed=false;lastServer=state;paintServer(state);
 }catch(e){
  lastLoadFailed=true;
  if(!lastServer)$('recommendations').innerHTML='<p>자료 조회 실패로 추천을 보류합니다.</p>';
  if(lastServer)paintServer(lastServer);
  $('status').textContent='서버 결과 조회 실패';$('progress').textContent='서버 결과를 가져오지 못했습니다: '+e.message+' · 화면의 결과가 있다면 이전 자료입니다. 서버 마지막 완료 시각을 확인해 주세요.';
 }finally{busy=false;if($('auto').checked)timer=setTimeout(loadServer,300000);}
}
setInterval(()=>{if(lastServer&&!document.hidden)paintServer(lastServer);},30000);
$('start').onclick=loadServer;$('refresh').onclick=loadServer;
$('auto').onchange=()=>{clearTimeout(timer);timer=null;if($('auto').checked&&!busy)loadServer();};
document.addEventListener('visibilitychange',()=>{if(document.hidden)live?.stop();else{live?.resume();if(!busy)loadServer();}});
window.addEventListener?.('pagehide',()=>live?.stop());
$('status').textContent='서버 결과 확인 중';
loadServer();
})();

