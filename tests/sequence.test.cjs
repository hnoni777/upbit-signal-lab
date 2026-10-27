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
test('live scan requests every market, renders both stages, and records no probability',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',checked:false,disabled:false});return elements.get(id);};
 const store=new Map(),requests=[];const now=cutoff+10000;
 class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
 const markets=Array.from({length:7},(_,i)=>({market:'KRW-T'+i,korean_name:'테스트'+i}));
 const context={window:{SequenceSignal:S},document:{getElementById:el,addEventListener(){}},Date:Clock,AbortController,console,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},setTimeout:(cb,ms)=>{if(ms<2000)queueMicrotask(cb);return 1;},clearTimeout(){},confirm:()=>true,fetch:async url=>{requests.push(url);return {ok:true,json:async()=>url.includes('raw.githubusercontent.com')?{schema:52,totals:{},history:[],snapshot:null}:url.includes('/market/all')?markets:url.includes('KRW-T0')?confirmed():bars()};}};
 vm.runInNewContext(fs.readFileSync('app.js','utf8'),context);await el('reset').onclick();
 assert.equal(requests.filter(u=>!u.includes('raw.githubusercontent.com')).length,8);assert.equal(el('compared').textContent,7);
 assert.match(el('results').innerHTML,/조기 관심/);assert.match(el('results').innerHTML,/돌파 확인/);
 const records=JSON.parse([...store.values()][0]);assert.equal(records.length,7);assert.ok(records.every(r=>r.entryCutoff>r.observedAt));
 assert.match(el('validation').textContent,/아직 검증하지 않았습니다/);
});
