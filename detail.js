'use strict';
// Descriptive closed-bar checks; fixed research rules, never calibrated probabilities.
const S=typeof module!=='undefined'&&module.exports?require('./sequence.js'):globalThis.SequenceSignal;
(function(root){
const stable=new Set(['USDT','USDC','DAI','USDE','USD1','USDS','FDUSD','TUSD','PYUSD','USDD']);
const sum=a=>a.reduce((s,c)=>s+Number(c.candle_acc_trade_price),0),high=a=>Math.max(...a.map(c=>Number(c.high_price))),low=a=>Math.min(...a.map(c=>Number(c.low_price)));
const price=c=>Number(c.trade_price),pct=(a,b)=>100*(a/b-1);
function analyze(rows,cutoff,{market='',btcReturn=null,previous=null}={}){
 const f=S.features(rows,cutoff);if(!f)return null;
 const a=S.regularize(rows,cutoff-60*60000,cutoff),p=price(a.at(-1));
 const ret=n=>pct(p,price(a.at(-n-1))),returns=Object.fromEntries([1,3,5,15,30].map(n=>[n,ret(n)]));
 const ema=n=>{let v=price(a[0]);for(const c of a.slice(1))v+=2/(n+1)*(price(c)-v);return v;};
 const ema9=ema(9),ema20=ema(20),tail=a.slice(-20),volume=tail.reduce((v,c)=>v+Number(c.candle_acc_trade_volume||0),0);
 const vwap20=volume>0?sum(tail)/volume:null;
 const tr=a.slice(-14).map((c,j)=>{const prev=price(a[a.length-15+j]);return Math.max(Number(c.high_price)-Number(c.low_price),Math.abs(Number(c.high_price)-prev),Math.abs(Number(c.low_price)-prev));});
 const atr=tr.reduce((s,v)=>s+v,0)/tr.length;
 const level=high(a.slice(-23,-3)),support=low(a.slice(-10)),resistance=high(a.slice(-20));
 const active15=a.slice(-15).filter(c=>Number(c.candle_acc_trade_price)>0).length;
 const lastTrade=a.map((c,i)=>Number(c.candle_acc_trade_price)>0?i:-1).filter(i=>i>=0).at(-1);
 const silenceMinutes=lastTrade===undefined?60:59-lastTrade;
 const setupActive=a.slice(-15,-5).filter(c=>Number(c.candle_acc_trade_price)>0).length;
 const baselinePerMinute=sum(a.slice(0,45))/45;
 const recentRatio=baselinePerMinute>0?sum(a.slice(-3))/(3*baselinePerMinute):null;
 const continuation=recentRatio>=1.3&&a.slice(-3).filter(c=>Number(c.candle_acc_trade_price)>0).length>=2;
 const hold=a.slice(-3).filter(c=>price(c)>=level).length>=2;
 const failed=high(a.slice(-15))>level*1.001&&p<level*.997;
 const pullback=pct(p,high(a.slice(-15))),lowRising=low(a.slice(-3))>=low(a.slice(-6,-3))*.999;
 const aboveTrend=p>=ema9&&ema9>=ema20,extensionAtr=atr>0?(p-ema20)/atr:0;
 const flags=[];
 if(stable.has(market.replace('KRW-','')))flags.push('달러 연동 종목: 급등 후보 제외');
 if(active15<5||setupActive<3)flags.push('실제 거래가 있었던 분이 적음');
 if(baselinePerMinute<100000)flags.push('평소 거래대금이 적어 증가 배수가 과장될 수 있음');
 if(silenceMinutes>=3)flags.push('최근 3분 이상 실제 거래 없음');
 if(!continuation)flags.push('최근 3분 거래 증가가 이어지지 않음');
 if(failed)flags.push('직전 돌파 가격 아래로 되밀림');
 if(extensionAtr>3)flags.push('최근 변동폭 대비 가격 이격이 큼');
 if(pullback<-1.5)flags.push('최근 15분 고점에서 1.5% 이상 밀림');
 if(btcReturn!==null&&ret(15)-btcReturn<0)flags.push('최근 15분 비트코인 대비 약함');
 const invalidated=previous?.breakoutLevel>0&&p<previous.breakoutLevel*.997;
 let status='watch';
 if(silenceMinutes>=3||failed||invalidated||(ret(3)<-.5&&!aboveTrend))status='weakening';
 else if(aboveTrend&&hold&&continuation&&ret(3)>=0)status='maintaining';
 else if(lowRising&&pullback<-.1&&pullback>=-1.5&&p>=ema20*.998)status='pullback';
 const excluded=stable.has(market.replace('KRW-',''))||active15<5||setupActive<3;
 const quality=(aboveTrend?20:0)+(hold?20:0)+(continuation?20:0)+(lowRising?10:0)+(ret(3)>0?10:0)+(ret(15)>0?10:0)+(btcReturn!==null&&ret(15)>btcReturn?10:0)-flags.length*5-(status==='weakening'?25:0);
 return {version:54,cutoff,price:p,returns,ema9,ema20,vwap20,atrPct:atr/p*100,extensionAtr,breakoutLevel:level,support,resistance,pullback,active15,setupActive,silenceMinutes,baselinePerMinute,recentRatio,continuation,hold,lowRising,aboveTrend,status,excluded,flags,quality,relativeBtc15:btcReturn===null?null:ret(15)-btcReturn,spark:a.map(price)};
}
const api={analyze};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SignalDetail=api;
})(typeof globalThis!=='undefined'?globalThis:this);
