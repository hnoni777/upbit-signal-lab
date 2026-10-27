'use strict';
// Shared by the live scanner and offline chronological replay. Thresholds are hypotheses.
(function(root){
 const MINUTE=60000, CONFIG={version:51,target:3,stop:2,horizon:30,cost:.3,minTurnover:1e7};
 const time=c=>Date.parse(c.candle_date_time_utc.replace(/Z?$/,'Z'));
 const sum=a=>a.reduce((s,c)=>s+Number(c.candle_acc_trade_price),0);
 const avg=a=>sum(a)/a.length;
 const low=a=>Math.min(...a.map(c=>Number(c.low_price)));
 const high=a=>Math.max(...a.map(c=>Number(c.high_price)));
 const close=c=>Number(c.trade_price);
 function ordered(rows){return [...new Map(rows.map(c=>[time(c),c])).values()].sort((a,b)=>time(a)-time(b));}
 function valid(c){return ['opening_price','trade_price','low_price','high_price'].every(k=>Number.isFinite(Number(c[k]))&&Number(c[k])>0)&&Number.isFinite(Number(c.candle_acc_trade_price))&&Number(c.candle_acc_trade_price)>=0&&Number(c.low_price)<=Math.min(Number(c.opening_price),close(c))&&Number(c.high_price)>=Math.max(Number(c.opening_price),close(c))&&Number.isFinite(time(c));}
 // Upbit omits minutes with no trades. Only a typed 1-minute API snapshot
 // covering the start boundary can supply a previous close for zero-trade bars.
 function regularize(rows,start,end){
  const raw=ordered(rows.filter(c=>time(c)<end));
  if(!raw.length||raw.some(c=>!valid(c)||Number(c.unit)!==1)||time(raw[0])>start)return raw.filter(c=>time(c)>=start);
  const byTime=new Map(raw.map(c=>[time(c),c]));
  let previous=raw.filter(c=>time(c)<=start).at(-1);const out=[];
  for(let t=start;t<end;t+=MINUTE){
   let c=byTime.get(t);
   if(!c){const p=close(previous);c={unit:1,candle_date_time_utc:new Date(t).toISOString(),opening_price:p,trade_price:p,high_price:p,low_price:p,candle_acc_trade_price:0};}
   out.push(c);previous=c;
  }
  return out;
 }
 function features(rows,cutoff){
  const a=regularize(rows,cutoff-60*MINUTE,cutoff);
  if(a.length!==60||a.some((c,i)=>!valid(c)||time(c)!==cutoff-(60-i)*MINUTE))return null;
  const base=a.slice(0,45),setup=a.slice(45,55),trigger=a.slice(55),prev=setup.slice(0,5),last=setup.slice(5);
  const b=avg(base);if(b<=0)return null;
  const setupRatio=avg(setup)/b,triggerRatio=avg(trigger)/b;
  const rise=100*(close(a.at(-1))/close(a[44])-1);
  const range=100*(high(base)/low(base)-1);
  const hold=low(last)>=low(prev)*.998;
  const closesUp=setup.filter(c=>close(c)>=Number(c.opening_price)).length;
  const persistence=setup.filter(c=>Number(c.candle_acc_trade_price)>=b*1.3).length;
  const breakout=close(a.at(-1))>high(setup)*1.001;
  const sustained=trigger.slice(-3).filter(c=>close(c)>=high(setup)).length>=2;
  const pullback=100*(close(a.at(-1))/high(trigger)-1);
  const turnover=sum(a.slice(-15));
  const score=Math.min(25,setupRatio*5)+Math.min(25,triggerRatio*5)+persistence*2+(hold?10:0)+(breakout?10:0)+(sustained?10:0);
  return {setupRatio,triggerRatio,rise,range,hold,closesUp,persistence,breakout,sustained,pullback,turnover,score:Math.min(100,score),price:close(a.at(-1)),cutoff};
 }
 function detect(rows,cutoff){
  const f=features(rows,cutoff);if(!f)return {stage:'missing',reason:'연속된 닫힌 1분봉 60개 필요'};
  if(f.turnover<CONFIG.minTurnover)return {stage:'illiquid',f,reason:'최근 15분 거래대금 1천만원 미만'};
  if(f.rise>=5)return {stage:'extended',f,reason:'최근 15분 이미 5% 이상 상승'};
  // Setup must PRECEDE the trigger, rather than detecting a single volume spike.
  const setup=f.range<=3&&f.setupRatio>=1.5&&f.persistence>=4&&f.hold&&f.closesUp>=5;
  if(!setup)return {stage:'quiet',f,reason:'선행 거래 증가·가격 버팀 조건 미충족'};
  if(f.breakout&&f.sustained&&f.triggerRatio>=2&&f.rise>0&&f.pullback>=-1)return {stage:'confirmed',f,reason:'선행 거래 증가 → 저점 유지 → 소폭 돌파·유지'};
  if(!f.breakout&&f.rise>=-.5&&f.rise<3)return {stage:'watch',f,reason:'선행 거래 증가와 저점 유지 · 돌파 확인 전'};
  return {stage:'quiet',f,reason:'선행 흔적 이후 돌파 유지 조건 미충족'};
 }
 function outcome(rows,cutoff,asOf){
  const end=cutoff+CONFIG.horizon*MINUTE;
  const a=asOf>=end?regularize(rows,cutoff,end):ordered(rows.filter(c=>time(c)>=cutoff&&time(c)<end));
  if(a.length!==CONFIG.horizon||a.some((c,i)=>!valid(c)||time(c)!==cutoff+i*MINUTE))return null;
  const entry=Number(a[0].opening_price),target=entry*(1+(CONFIG.target+CONFIG.cost)/100),stop=entry*(1-CONFIG.stop/100);
  let result='timeout',net=100*(close(a.at(-1))/entry-1)-CONFIG.cost;
  for(const c of a){
   const hit=Number(c.high_price)>=target,loss=Number(c.low_price)<=stop;
   if(hit&&loss){result='ambiguous';net=-CONFIG.stop-CONFIG.cost;break;}
   if(loss){result='stop';net=-CONFIG.stop-CONFIG.cost;break;}
   if(hit){result='target';net=CONFIG.target;break;}
  }
  return {result,net,entry,maxRise:100*(high(a)/entry-1),maxFall:100*(low(a)/entry-1),end:cutoff+CONFIG.horizon*MINUTE};
 }
 const api={CONFIG,time,features,detect,outcome,regularize};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SequenceSignal=api;
})(typeof globalThis!=='undefined'?globalThis:this);
