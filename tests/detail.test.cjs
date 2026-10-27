const test=require('node:test'),assert=require('node:assert/strict'),D=require('../detail.js');
const end=Date.parse('2026-10-27T00:00:00Z');
function bars(){return Array.from({length:100},(_,i)=>{const p=i<85?100:100+(i-84)*.04;return {unit:1,candle_date_time_utc:new Date(end-(100-i)*60000).toISOString(),opening_price:p-.01,trade_price:p,high_price:p+.02,low_price:p-.03,candle_acc_trade_price:i<85?1e6:3e6,candle_acc_trade_volume:(i<85?1e6:3e6)/p};});}
test('multi-window returns and VWAP are computed from known closes only',()=>{
 const a=bars(),d=D.analyze(a,end,{market:'KRW-HOME',btcReturn:.2});
 assert.ok(d.returns[1]>0&&d.returns[15]>d.returns[5]);assert.ok(d.vwap20>100&&d.vwap20<d.price);
 assert.ok(Math.abs(d.relativeBtc15-(d.returns[15]-.2))<1e-10);
 const future={...a.at(-1),candle_date_time_utc:new Date(end).toISOString(),trade_price:999};
 assert.deepEqual(d,D.analyze([...a,future],end,{market:'KRW-HOME',btcReturn:.2}));
});
test('fake huge volume multiplier over a tiny baseline produces a warning',()=>{
 const a=bars();for(const c of a.slice(0,85))c.candle_acc_trade_price=100;
 assert.ok(D.analyze(a,end).flags.some(s=>s.includes('과장')));
});
test('known dollar-linked assets are excluded without excluding speculative coins',()=>{
 assert.equal(D.analyze(bars(),end,{market:'KRW-USDC'}).excluded,true);assert.equal(D.analyze(bars(),end,{market:'KRW-HOME'}).excluded,false);
});
test('price below previously observed breakout marks a weakening signal',()=>{
 assert.equal(D.analyze(bars(),end,{previous:{breakoutLevel:102}}).status,'weakening');
});
test('zero-trade padding is not counted as active trading or ongoing momentum',()=>{
 const a=bars();for(const c of a.slice(-4))c.candle_acc_trade_price=0;
 const d=D.analyze(a,end);assert.equal(d.silenceMinutes,4);assert.equal(d.active15,11);assert.equal(d.status,'weakening');
});
