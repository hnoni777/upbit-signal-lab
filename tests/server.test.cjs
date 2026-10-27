const test=require('node:test'),assert=require('node:assert/strict');
const {initial,scan}=require('../scripts/server_scan.cjs');
const MIN=60000,cutoff=Date.parse('2026-10-27T00:00:00Z');
const markets=Array.from({length:6},(_,i)=>({market:'KRW-T'+i,korean_name:'코인'+i}));
function bars(end= cutoff){return Array.from({length:100},(_,i)=>({unit:1,candle_date_time_utc:new Date(end-(100-i)*MIN).toISOString(),opening_price:100,trade_price:100.05,high_price:100.2,low_price:99.9,candle_acc_trade_price:i>=85?2e6:1e6}));}
const getter=(end=cutoff)=>async path=>path.startsWith('/market/all')?markets:bars(end);
test('server scans the whole universe and deduplicates repeated observations',async()=>{
 const state=await scan(initial(),{get:getter(),now:()=>cutoff+10000});
 assert.equal(state.snapshot.counts.requested,6);assert.equal(state.snapshot.counts.valid,6);assert.equal(state.history.length,6);
 assert.ok(state.history.every(r=>r.entryCutoff>r.observedAt));
 const again=await scan(state,{get:getter(),now:()=>cutoff+10000});assert.equal(again.history.length,6);assert.equal(again.runCount,2);
});
test('a later independent server run settles signals while all phones can be offline',async()=>{
 const first=await scan(initial(),{get:getter(),now:()=>cutoff+10000});
 const second=await scan(first,{get:getter(cutoff+35*MIN),now:()=>cutoff+35*MIN+10000});
 assert.equal(second.totals.watch.evaluated,6);assert.equal(second.totals.watch.timeout,6);
 const third=await scan(second,{get:getter(cutoff+35*MIN),now:()=>cutoff+35*MIN+10000});assert.equal(third.totals.watch.evaluated,6);
 assert.equal(first.totals.watch.evaluated,0);
});
test('API outage throws without mutating the previous durable snapshot',async()=>{
 const state=await scan(initial(),{get:getter(),now:()=>cutoff+10000});const before=JSON.stringify(state);
 await assert.rejects(scan(state,{get:async()=>{throw Error('offline');},now:()=>cutoff+35*MIN}));assert.equal(JSON.stringify(state),before);
 await assert.rejects(scan(state,{get:async p=>p.startsWith('/market/all')?markets:Promise.reject(Error('offline')),now:()=>cutoff+35*MIN}));assert.equal(JSON.stringify(state),before);
});
test('partial query failure preserves that market pending evaluation',async()=>{
 const first=await scan(initial(),{get:getter(),now:()=>cutoff+10000});
 const second=await scan(first,{get:async p=>p.includes('KRW-T0')?Promise.reject(Error('one coin offline')):getter(cutoff+35*MIN)(p),now:()=>cutoff+35*MIN+10000});
 assert.equal(second.snapshot.counts.errors,1);assert.equal(second.totals.watch.evaluated,5);
 assert.equal(second.history.find(r=>r.market==='KRW-T0').outcome,undefined);
});
test('late scan labels stale snapshot and does not pretend to have observed fresh signals',async()=>{
 let calls=0;const state=await scan(initial(),{get:getter(),now:()=>cutoff+(calls++?4*MIN:10000)});
 assert.equal(state.snapshot.stale,true);assert.equal(state.history.length,0);assert.equal(state.snapshot.candidates.length,6);
});
