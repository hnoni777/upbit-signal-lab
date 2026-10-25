'use strict';
/* v32: delisting-event research, explicit notice confirmation and KST 08-11 candle review. */
(()=>{
 const $=id=>document.getElementById(id);
 const KEY='usl-delisting-events-v1';
 const fixed=[{market:'KRW-BLAST',end:'2026-10-26T12:00',source:'https://xangle.io/insight/events/6acf33714eb16c77acf98fe4',note:'2026-10-14 거래지원 종료 공지'}];
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let extras=[];try{extras=JSON.parse(localStorage.getItem(KEY)||'[]');if(!Array.isArray(extras))extras=[]}catch(e){}
 const entries=()=>[...fixed,...extras.filter(e=>!fixed.some(f=>f.market===e.market))];
 function save(){try{localStorage.setItem(KEY,JSON.stringify(extras))}catch(e){}}
 const kstDate=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 function showEntries(){
  const sel=$('delistCoin'),chosen=sel.value;
  sel.innerHTML=entries().map(e=>'<option value="'+esc(e.market)+'">'+esc(e.market)+' · 종료 '+esc(e.end.replace('T',' '))+'</option>').join('');
  if(entries().some(e=>e.market===chosen))sel.value=chosen;
  $('delistList').innerHTML=entries().map(e=>'<p><b>'+esc(e.market)+'</b> · 종료 예정 '+esc(e.end.replace('T',' '))+' KST · '+esc(e.note||'사용자 등록')+' · <a href="'+esc(e.source)+'" target="_blank" rel="noopener noreferrer">공지 확인</a>'+(fixed.some(f=>f.market===e.market)?'':' <button data-del-remove="'+esc(e.market)+'">삭제</button>')+'</p>').join('');
 }
 async function fetch15(market,date){
  // KST 11:30 is UTC 02:30 on the selected calendar day; exclusive cursor at 03:00 UTC.
  const to=date+'T03:00:00Z';
  const path='/candles/minutes/15?market='+encodeURIComponent(market)+'&count=200&to='+encodeURIComponent(to);
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),20000);
  try{
   const res=await fetch(API+path,{signal:ctl.signal});
   if(!res.ok)throw Error('API HTTP '+res.status);
   const rows=await res.json();if(!Array.isArray(rows))throw Error('분봉 응답 형식 오류');
   return rows.sort((a,b)=>a.candle_date_time_utc.localeCompare(b.candle_date_time_utc));
  }finally{clearTimeout(timer)}
 }
 const krw=n=>Number(n).toLocaleString('ko-KR',{maximumFractionDigits:8});
 function analyse(rows,date){
  const day=rows.filter(c=>c.candle_date_time_kst?.slice(0,10)===date);
  const base=day.filter(c=>{const t=c.candle_date_time_kst.slice(11,16);return t>='08:00'&&t<'09:00'});
  const active=day.filter(c=>{const t=c.candle_date_time_kst.slice(11,16);return t>='08:00'&&t<'11:00'});
  if(!base.length||!active.length)return '<p>선택 날짜 08:00~11:00의 15분봉 데이터가 부족해 분석할 수 없습니다. 거래 종료 후에는 해당 시장의 분봉 조회가 불가능할 수 있습니다.</p>';
  const mean=base.reduce((s,c)=>s+Number(c.candle_acc_trade_price||0),0)/base.length;
  const open=Number(base[0].opening_price);
  const peak=Math.max(...active.map(c=>Number(c.high_price)));
  const first3=active.find(c=>Number(c.high_price)>=open*1.03);
  const first10=active.find(c=>Number(c.high_price)>=open*1.10);
  const pre=active.filter(c=>c.candle_date_time_kst.slice(11,16)<'09:00');
  const preMax=pre.length?Math.max(...pre.map(c=>Number(c.high_price))):open;
  const table=active.map(c=>{
   const t=c.candle_date_time_kst.slice(11,16),volume=Number(c.candle_acc_trade_price||0);
   const gain=(Number(c.trade_price)/Number(c.opening_price)-1)*100;
   const ratio=mean>0?volume/mean:0;
   return '<tr><td>'+t+'</td><td>'+krw(c.trade_price)+'</td><td>'+gain.toFixed(2)+'%</td><td>'+krw(volume/1000000)+'백만원</td><td>'+(mean>0?ratio.toFixed(1)+'배':'기준 없음')+'</td></tr>';
  }).join('');
  return '<div class="results"><b>'+esc(date)+' 08:00~11:00 KST 실제 15분봉 분석</b><p>08:00 기준 시가 '+krw(open)+'원 · 관찰 구간 최고가 '+krw(peak)+'원 · 시가 대비 최고 '+((peak/open-1)*100).toFixed(2)+'%</p><p>09:00 이전 최고가 '+krw(preMax)+'원 · 기준 대비 '+((preMax/open-1)*100).toFixed(2)+'%</p><p>첫 +3% 고가 도달: '+(first3?first3.candle_date_time_kst.slice(11,16):'미발생')+' · 첫 +10% 고가 도달: '+(first10?first10.candle_date_time_kst.slice(11,16):'미발생')+'</p><p>거래대금 배수는 08:00~09:00 네 개 15분봉의 평균 대비입니다. 상승 시각은 해당 15분봉의 시작 시각이며 정확한 체결 시각은 아닙니다.</p><div style="overflow-x:auto"><table><thead><tr><th>시간</th><th>종가(원)</th><th>봉 등락</th><th>거래대금</th><th>08시 대비</th></tr></thead><tbody>'+table+'</tbody></table></div></div>';
 }
 async function run(){
  const btn=$('delistRun'),out=$('delistResult'),market=$('delistCoin').value,date=$('delistDate').value;
  if(!market||!date){out.textContent='종목과 날짜를 선택해 주세요.';return}
  btn.disabled=true;out.textContent='15분봉을 조회하고 있습니다...';
  try{const rows=await fetch15(market,date);out.innerHTML=analyse(rows,date)}
  catch(e){out.textContent='조회 실패: '+e.message+' · 중계 API 지원 여부와 해당 종목 거래 상태를 확인해 주세요.'}
  finally{btn.disabled=false}
 }
 $('delistDate').value=kstDate();
 $('delistRun').onclick=run;
 $('delistAdd').onclick=()=>{
  const market=$('delistNewMarket').value.trim().toUpperCase();
  const end=$('delistNewEnd').value;
  const source=$('delistNewSource').value.trim();
  if(!/^KRW-[A-Z0-9]{2,20}$/.test(market)||!end||!/^https:\/\//.test(source)){alert('KRW-심볼, 종료 예정 시각, 공식 공지 https 링크를 입력해 주세요.');return}
  if(fixed.some(e=>e.market===market)){alert('이미 등록된 종목입니다.');return}
  extras=extras.filter(e=>e.market!==market);extras.push({market,end,source,note:'사용자 등록 · 공식 공지 확인 필요'});save();showEntries();$('delistCoin').value=market;
 };
 $('delistList').addEventListener('click',e=>{
  const market=e.target?.getAttribute('data-del-remove');if(!market)return;
  extras=extras.filter(x=>x.market!==market);save();showEntries();
 });
 showEntries();
})();
