const test=require('node:test'),assert=require('node:assert/strict'),L=require('../learner.cjs'),R=require('../recommend.js');
const DAY=86400000,now=Date.parse('2026-10-27T12:00:00Z');
function sample(at,g,j,flip=false){const win=(j<2)!==flip;return {id:at+'|'+g+'|'+j,market:'KRW-T'+j,slot:Math.floor(at/1800000)+g,observedAt:at+g*1800000,entryCutoff:at+g*1800000+60000,eligible:true,x:[j<2?1:-1,0,0,0,0,0,0,0,0,1,1,1],status:'maintaining',quality:win?0:100,outcome:{result:win?'target':'stop',net:win?3:-2.3,end:at+g*1800000+31*60000}};}
function data(days=60,flip=false){return Array.from({length:days},(_,day)=>Array.from({length:3},(_,g)=>Array.from({length:4},(_,j)=>sample(now-(days-day)*DAY,g,j,flip)))).flat(2);}
test('current completed observations apply immediately without day or count gates',()=>{
 const l=L.state();l.observations=data(2);L.update(l,now);
 assert.ok(l.champion);assert.equal(l.status,'immediate_applied');assert.equal(l.champion.trainingSamples,24);
 assert.equal(l.champion.validated,false);assert.equal(l.mode,'immediate');assert.equal(l.lastEvaluation,null);
});
test('predictive features are frozen before outcome and do not depend on later price',()=>{
 const row={market:'KRW-TEST',detail:{cutoff:now-60000,status:'maintaining',quality:80,active15:15,baselinePerMinute:1e6,continuation:true,recentRatio:2,aboveTrend:true,returns:{1:.1,3:.2,5:.3,15:1},relativeBtc15:.5,extensionAtr:1,pullback:-.1,price:100,vwap20:99,hold:true,lowRising:true,atrPct:.2}};
 const l=L.state();L.observe(l,{cutoff:now-60000,completedAt:now,candidates:[row]});assert.equal(l.observations.length,1);
 const x=l.observations[0].x.slice();row.detail.returns[15]=999;assert.deepEqual(l.observations[0].x,x);assert.equal(l.observations[0].outcome,undefined);
 L.observe(l,{cutoff:now-60000,completedAt:now,candidates:[row]});assert.equal(l.observations.length,1);
});
test('a new result retrains within the same day; identical inputs do not retrain',()=>{
 const l=L.state();l.observations=data(2);L.update(l,now);
 const first=l.champion,history=l.promotions.length;
 L.update(l,now+60000);assert.equal(l.champion,first);assert.equal(l.promotions.length,history);
 const fresh=sample(now-3600000,0,0);l.observations.push({...fresh,id:'new-result'});
 L.update(l,now+120000);assert.notEqual(l.champion.id,first.id);assert.equal(l.champion.trainingSamples,25);
 assert.equal(l.champion.trainedAt,now+120000);assert.equal(l.promotions.length,history+1);
});
test('unresolved, ineligible, missing, future, stale and malformed rows never train',()=>{
 const good=sample(now-DAY,0,0),l=L.state();
 l.observations=[good,{...good,id:'unresolved',outcome:undefined},{...good,id:'ineligible',eligible:false},
 {...good,id:'missing',missing:true},{...good,id:'future',outcome:{...good.outcome,end:now+1}},
 {...good,id:'stale',observedAt:now-91*DAY},{...good,id:'bad-x',x:[NaN]},
 {...good,id:'bad-end',outcome:{...good.outcome,end:good.observedAt-1}}];
 l.recommendations=[{...good,id:'repeated-top3'}];L.update(l,now);
 assert.equal(l.champion.trainingSamples,1);assert.equal(l.champion.positives,1);
 assert.ok(l.champion.weights.every(Number.isFinite));
});
test('empty completed dataset waits, single outcome class still learns, and past records remain',()=>{
 const l=L.state();L.update(l,now);assert.equal(l.champion,null);
 l.observations=[sample(now-DAY,0,3)];const original=JSON.stringify(l.observations);
 L.update(l,now);assert.ok(l.champion);assert.equal(l.champion.positives,0);assert.equal(l.champion.negatives,1);
 assert.equal(JSON.stringify(l.observations),original);
});
test('rolling window expiry retrains and summaries mark immediate models as unvalidated',()=>{
 const l=L.state();l.observations=[sample(now-90*DAY+60000,0,0),sample(now-DAY,0,3)];
 L.update(l,now);const first=l.champion.id;L.update(l,now+120000);
 assert.notEqual(l.champion.id,first);assert.equal(l.champion.trainingSamples,1);
 const summary=L.summary(l);assert.equal(summary.mode,'immediate');assert.equal(summary.champion.validated,false);
 assert.equal(summary.lastUpdatedAt,now+120000);
});
test('shared ranking and learning use identical feature definitions and scores',()=>{const rows=data();const m=L.train(rows);const r={detail:{returns:{1:.1,3:.2,5:.3,15:1},relativeBtc15:.4,recentRatio:2,pullback:-.2,atrPct:.3,extensionAtr:1,active15:15,aboveTrend:true,hold:true}};assert.equal(L.predict(m,L.features(r)),R.learnedScore(m,r));});
test('recommendation outcomes settle separately and are never counted twice',()=>{
 const l=L.state(),entry=now-31*60000;
 l.observations=[{market:'KRW-T',entryCutoff:entry}];l.recommendations=[{market:'KRW-T',entryCutoff:entry}];
 const rows=Array.from({length:30},(_,i)=>({unit:1,candle_date_time_utc:new Date(entry+i*60000).toISOString(),opening_price:100,trade_price:100,high_price:i===2?104:101,low_price:99,candle_acc_trade_price:1e6}));
 L.settle(l,'KRW-T',rows,now);assert.equal(l.observations[0].outcome.result,'target');assert.equal(l.recommendations[0].outcome.result,'target');assert.equal(l.stats.resolved,2);
 L.settle(l,'KRW-T',rows,now);assert.equal(l.stats.resolved,2);
});

