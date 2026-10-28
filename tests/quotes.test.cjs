const {test}=require('node:test'),assert=require('node:assert/strict'),Q=require('../quotes.js');
const now=100000;
const book={type:'orderbook',code:'KRW-BTC',timestamp:now,orderbook_units:[{ask_price:101,bid_price:99,ask_size:2,bid_size:3},{ask_price:102,bid_price:98,ask_size:1,bid_size:4}]};
test('quote spread and nearby depth use price times quantity, not total coin sizes',()=>{const q=Q.parse(book,now);assert.equal(q.spread,2);assert.equal(q.bidKrw,689);assert.equal(q.askKrw,304);assert.equal(Q.parse({...book,orderbook_units:[{...book.orderbook_units[0],ask_price:98}]},now),null);});
test('bad prices, future frames and stale trades cannot be labeled current',()=>{assert.equal(Q.parse({...book,timestamp:now+31000},now),null);assert.equal(Q.parse({...book,orderbook_units:[{...book.orderbook_units[0],bid_size:-1}]},now),null);const q=Q.parse({type:'ticker',code:'KRW-BTC',timestamp:now,trade_timestamp:now-16000,trade_price:100},now);assert.equal(Q.fresh(q,true,now),false);assert.equal(Q.fresh(Q.parse(book,now),false,now),false);assert.equal(Q.fresh(Q.parse(book,now),true,now+16000),false);});
test('subscription changes throttle connections and ignore old, foreign and out-of-order frames',async()=>{
 let clock=now,jobs=[],sockets=[],latest;class WS{constructor(url){this.url=url;sockets.push(this);}send(s){this.sent=JSON.parse(s);}close(){this.onclose?.();}}
 const c=Q.create(s=>latest=s,{WebSocket:WS,now:()=>clock,setTimeout:(fn,delay)=>{const j={fn,delay};jobs.push(j);return j;},clearTimeout:j=>{jobs=jobs.filter(x=>x!==j);}});
 c.set(['KRW-BTC']);jobs.shift().fn();const first=sockets[0];first.onopen();assert.equal(first.sent[2].codes[0],'KRW-BTC.5');await first.onmessage({data:JSON.stringify(book)});assert.equal(latest.data['KRW-BTC'].book.bid,99);
 await first.onmessage({data:JSON.stringify({...book,timestamp:now-1})});assert.equal(latest.data['KRW-BTC'].book.time,now);
 c.set(['KRW-ETH']);assert.ok(jobs[0].delay>=11000);await first.onmessage({data:JSON.stringify(book)});assert.equal(latest.data['KRW-BTC'],undefined);
 c.stop();assert.equal(jobs.length,0);c.resume();clock+=11000;jobs.shift().fn();assert.equal(sockets.length,2);c.stop();assert.equal(latest.connected,false);
});
