const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../sequence.js');
const cutoff=Date.parse('2026-10-27T00:00:00Z');
function bars(){return Array.from({length:60},(_,i)=>({candle_date_time_utc:new Date(cutoff-(60-i)*60000).toISOString().slice(0,-1),opening_price:100,trade_price:100.05,high_price:100.2,low_price:99.9,candle_acc_trade_price:i>=45?2e6:1e6}));}
function confirmed(){const a=bars();for(let i=55;i<60;i++)Object.assign(a[i],{opening_price:100.3,trade_price:100.6,high_price:100.7,low_price:100.2,candle_acc_trade_price:3e6});return a;}
function future(){return Array.from({length:30},(_,i)=>({candle_date_time_utc:new Date(cutoff+i*60000).toISOString(),opening_price:100,trade_price:100,high_price:101,low_price:99,candle_acc_trade_price:1e6}));}
test('setup is watch; following sustained breakout is confirmed',()=>{assert.equal(S.detect(bars(),cutoff).stage,'watch');assert.equal(S.detect(confirmed(),cutoff).stage,'confirmed');});
test('one volume spike cannot replace preceding setup',()=>{const a=confirmed();for(let i=45;i<55;i++)a[i].candle_acc_trade_price=1e6;assert.equal(S.detect(a,cutoff).stage,'quiet');});
test('missing or stale candles do not produce a signal',()=>{assert.equal(S.detect(bars().slice(1),cutoff).stage,'missing');assert.equal(S.detect(bars(),cutoff+60000).stage,'missing');});
test('unfinished/future candles never change features',()=>{const a=confirmed();assert.deepEqual(S.detect(a,cutoff),S.detect([...a,...future()],cutoff));});
test('sorted deduplication is deterministic and malformed prices fail closed',()=>{const a=confirmed();assert.deepEqual(S.detect(a,cutoff),S.detect([...a,a[0]].reverse(),cutoff));a[59].trade_price=NaN;assert.equal(S.detect(a,cutoff).stage,'missing');});
test('target, stop, and ambiguous same-bar ordering account for cost conservatively',()=>{const a=future();a[2].high_price=104;assert.equal(S.outcome(a,cutoff).result,'target');assert.equal(S.outcome(a,cutoff).net,3);a[1].low_price=97;assert.equal(S.outcome(a,cutoff).result,'stop');assert.equal(S.outcome(a,cutoff).net,-2.3);a[1].high_price=104;assert.equal(S.outcome(a,cutoff).result,'ambiguous');});
test('incomplete evaluation is unknown, not a win/loss',()=>{assert.equal(S.outcome(future().slice(1),cutoff),null);});
test('typed API no-trade minutes are filled with zero turnover, without inventing price changes',()=>{
 const a=confirmed().map(c=>({...c,unit:1}));a.splice(10,1);
 const filled=S.regularize(a,cutoff-60*60000,cutoff);
 assert.equal(filled.length,60);assert.equal(filled[10].candle_acc_trade_price,0);assert.equal(filled[10].trade_price,filled[9].trade_price);
 assert.equal(S.detect(a,cutoff).stage,'confirmed');
 // Without a starting observation or documented unit, missing remains unknown.
 assert.equal(S.detect(a.slice(1),cutoff).stage,'missing');
});
test('entry is next bar open rather than previous signal close',()=>{const a=future().map(c=>({...c,opening_price:110,trade_price:110,high_price:111,low_price:109}));assert.equal(S.outcome(a,cutoff).entry,110);assert.equal(S.outcome(a,cutoff).result,'timeout');});
