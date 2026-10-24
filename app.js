'use strict';
const API='https://upbit-signal-proxy.parkdam6.workers.dev/v1';
let markets=[],tickers=[];
let watch=new Set(JSON.parse(localStorage.getItem('usl-watch')||'["KRW-SHIB"]'));
const $=id=>document.getElementById(id);
const fmt=(n,d=0)=>Number(n).toLocaleString('ko-KR',{maximumFractionDigits:d});
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function get(path){const r=await fetch(API+path,{headers:{accept:'application/json'}});if(!r.ok)throw Error('API HTTP '+r.status);return r.json()}
function score(t){const change=t.signed_change_rate*100,vol=t.acc_trade_price_24h;return Math.min(100,Math.max(0,Math.round(25+change*3+Math.log10(Math.max(vol,1)/1e8)*12)))}
async function load(){
 try{
  $('status').textContent='업비트 연결 중';
  if(!markets.length)markets=(await get('/market/all?isDetails=false')).filter(m=>m.market.startsWith('KRW-'));
  const all=[];
  for(let i=0;i<markets.length;i+=80){const batch=markets.slice(i,i+80);all.push(...await get('/ticker?markets='+encodeURIComponent(batch.map(m=>m.market).join(','))))}
  tickers=all.map(t=>({...t,meta:markets.find(m=>m.market===t.market)}));
  $('count').textContent=fmt(tickers.length);
  $('updated').textContent=new Date().toLocaleTimeString('ko-KR');
  $('status').textContent='시세 연결됨';render();
 }catch(e){$('status').textContent='조회 실패';$('coins').innerHTML='<tr><td colspan="5">조회 실패: '+esc(e.message)+' · 새로고침을 눌러 주세요.</td></tr>'}
}
function render(){
 const q=$('search').value.toLowerCase(),order=$('sort').value;
 let list=tickers.filter(t=>(t.market+' '+(t.meta?.korean_name||'')).toLowerCase().includes(q));
 list.sort((a,b)=>order==='volume'?b.acc_trade_price_24h-a.acc_trade_price_24h:order==='change'?b.signed_change_rate-a.signed_change_rate:score(b)-score(a));
 $('candidates').textContent=fmt(tickers.filter(t=>score(t)>=75).length);
 $('coins').innerHTML=list.map(t=>'<tr><td><b>'+esc(t.meta?.korean_name||t.market)+'</b><br><span class="muted">'+esc(t.market)+'</span></td><td class="'+(t.signed_change_rate>=0?'positive':'negative')+'">'+(t.signed_change_rate>=0?'+':'')+(t.signed_change_rate*100).toFixed(2)+'%</td><td>'+fmt(t.acc_trade_price_24h/1e8,1)+'억</td><td>'+score(t)+'점</td><td><button class="star" data-market="'+esc(t.market)+'">'+(watch.has(t.market)?'★':'☆')+'</button></td></tr>').join('')||'<tr><td colspan="5">일치하는 종목이 없습니다.</td></tr>';
 $('watchlist').innerHTML=[...watch].map(m=>{const t=tickers.find(x=>x.market===m);return '<div class="watchitem"><span>'+esc(t?.meta?.korean_name||m)+' ('+esc(m)+')</span><span>'+(t?fmt(t.trade_price,8)+'원':'시세 대기')+'</span></div>'}).join('')||'<p>관심 종목이 없습니다.</p>';
 const shib=tickers.find(t=>t.market==='KRW-SHIB');
 $('shibStatus').textContent=shib?'현재 '+fmt(shib.trade_price,8)+'원 · '+(shib.trade_price>=0.00727?'본전 기준 이상':'본전 기준 미만')+' (수수료 제외)':'시바이누 시세 없음';
}
$('coins').addEventListener('click',e=>{const b=e.target.closest('[data-market]');if(!b)return;const m=b.dataset.market;watch.has(m)?watch.delete(m):watch.add(m);localStorage.setItem('usl-watch',JSON.stringify([...watch]));render()});
$('search').oninput=render;$('sort').onchange=render;$('refresh').onclick=load;
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id===b.dataset.tab))});
$('runBacktest').onclick=async()=>{
 const out=$('backtestResult');out.textContent='과거 60분봉 불러오는 중...';
 try{
  const market=$('backtestCoin').value,target=Number($('target').value);
  let candles=await get('/candles/minutes/60?market='+encodeURIComponent(market)+'&count=200');candles.reverse();
  let signals=0,hits=0,eligible=0,events=0;
  for(let i=12;i<candles.length-6;i++){
   const prev=candles.slice(i-6,i),prev12=candles.slice(i-12,i);
   const volAvg=prev.reduce((s,c)=>s+c.candle_acc_trade_volume,0)/6;
   const signal=candles[i].candle_acc_trade_volume>volAvg*1.8&&candles[i].trade_price>Math.max(...prev12.map(c=>c.trade_price));
   const futureHigh=Math.max(...candles.slice(i+1,i+7).map(c=>c.high_price));
   const hit=futureHigh>=candles[i].trade_price*(1+target);
   eligible++;if(hit)events++;if(signal){signals++;if(hit)hits++}
  }
  const pct=(a,b)=>b?((a/b)*100).toFixed(1)+'%':'해당 없음';
  out.innerHTML='<b>'+esc(market)+' · '+candles.length+'개 60분봉</b><p>평가 가능한 시점 '+eligible+'개 · 급등 사건 '+events+'개</p><p>탐지 신호 '+signals+'개 · 신호 적중 '+hits+'개</p><p>정밀도 '+pct(hits,signals)+' · 재현율 '+pct(hits,events)+' · 전체 급등 비율 '+pct(events,eligible)+'</p><p>주의: 중첩 시점과 단일 종목의 짧은 표본을 사용한 교육용 탐색 결과입니다. 독립적인 성과 검증이 아닙니다.</p>';
 }catch(e){out.textContent='검증 실패: '+e.message}
};
load();setInterval(()=>{if(!document.hidden)load()},60000);
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
