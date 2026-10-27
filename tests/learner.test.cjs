const test=require('node:test'),assert=require('node:assert/strict'),L=require('../learner.cjs'),R=require('../recommend.js');
const DAY=86400000,now=Date.parse('2026-10-27T12:00:00Z');
function sample(at,g,j,flip=false){const win=(j<2)!==flip;return {id:at+'|'+g+'|'+j,market:'KRW-T'+j,slot:Math.floor(at/1800000)+g,observedAt:at+g*1800000,entryCutoff:at+g*1800000+60000,eligible:true,x:[j<2?1:-1,0,0,0,0,0,0,0,0,1,1,1],status:'maintaining',quality:win?0:100,outcome:{result:win?'target':'stop',net:win?3:-2.3,end:at+g*1800000+31*60000}};}
function data(days=60,flip=false){return Array.from({length:days},(_,day)=>Array.from({length:3},(_,g)=>Array.from({length:4},(_,j)=>sample(now-(days-day)*DAY,g,j,flip)))).flat(2);}
test('insufficient live observations do not create or promote a learned model',()=>{const l=L.state();l.observations=data(2);L.update(l,now);assert.equal(l.champion,null);assert.equal(l.status,'collecting');});
test('predictive features are frozen before outcome and do not depend on later price',()=>{
 const row={market:'KRW-TEST',detail:{cutoff:now-60000,status:'maintaining',quality:80,active15:15,baselinePerMinute:1e6,continuation:true,recentRatio:2,aboveTrend:true,returns:{1:.1,3:.2,5:.3,15:1},relativeBtc15:.5,extensionAtr:1,pullback:-.1,price:100,vwap20:99,hold:true,lowRising:true,atrPct:.2}};
 const l=L.state();L.observe(l,{cutoff:now-60000,completedAt:now,candidates:[row]});assert.equal(l.observations.length,1);
 const x=l.observations[0].x.slice();row.detail.returns[15]=999;assert.deepEqual(l.observations[0].x,x);assert.equal(l.observations[0].outcome,undefined);
 L.observe(l,{cutoff:now-60000,completedAt:now,candidates:[row]});assert.equal(l.observations.length,1);
});
test('a challenger can promote only with a chronological later test and positive cost-adjusted result',()=>{const l=L.state();l.observations=data();L.update(l,now);assert.ok(l.champion);assert.equal(l.status,'promoted');assert.ok(l.champion.trainedThrough<l.champion.validationThrough);assert.ok(l.champion.validationThrough<l.champion.testThrough);assert.ok(l.lastEvaluation.test.meanNet>l.lastEvaluation.incumbent.meanNet);});
test('an exposed test window cannot be reused for the next promotion',()=>{const l=L.state();l.observations=data();L.update(l,now);const id=l.champion.id,watermark=l.testWatermark;L.update(l,now+DAY);assert.equal(l.champion.id,id);assert.equal(l.testWatermark,watermark);assert.ok(['fresh_holdout_needed','challenger_rejected'].includes(l.status));});
test('degraded prospective ranking rolls back to the fixed baseline',()=>{const l=L.state();const good=data();const m=L.train(good);l.champion={...m,id:'old',trainedAt:now-20*DAY};l.observations=data(10,true).map(r=>({...r,quality:r.outcome.result==='target'?100:0}));L.update(l,now);assert.equal(l.champion,null);assert.equal(l.status,'rolled_back');});
test('shared ranking and learning use identical feature definitions and scores',()=>{const rows=data();const m=L.train(rows);const r={detail:{returns:{1:.1,3:.2,5:.3,15:1},relativeBtc15:.4,recentRatio:2,pullback:-.2,atrPct:.3,extensionAtr:1,active15:15,aboveTrend:true,hold:true}};assert.equal(L.predict(m,L.features(r)),R.learnedScore(m,r));});
test('recommendation outcomes settle separately and are never counted twice',()=>{
 const l=L.state(),entry=now-31*60000;
 l.observations=[{market:'KRW-T',entryCutoff:entry}];l.recommendations=[{market:'KRW-T',entryCutoff:entry}];
 const rows=Array.from({length:30},(_,i)=>({unit:1,candle_date_time_utc:new Date(entry+i*60000).toISOString(),opening_price:100,trade_price:100,high_price:i===2?104:101,low_price:99,candle_acc_trade_price:1e6}));
 L.settle(l,'KRW-T',rows,now);assert.equal(l.observations[0].outcome.result,'target');assert.equal(l.recommendations[0].outcome.result,'target');assert.equal(l.stats.resolved,2);
 L.settle(l,'KRW-T',rows,now);assert.equal(l.stats.resolved,2);
});
