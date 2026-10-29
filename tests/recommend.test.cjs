const test=require('node:test'),assert=require('node:assert/strict'),R=require('../recommend.js');
const now=Date.parse('2026-10-27T12:00:00Z');
function row(market='KRW-TEST',status='maintaining',quality=80){return {market,name:'테스트',detail:{cutoff:now-60000,status,quality,active15:15,baselinePerMinute:2e6,continuation:true,recentRatio:2,aboveTrend:true,returns:{3:.2,15:1},relativeBtc15:.5,extensionAtr:2,pullback:-.3,price:100,vwap20:99,hold:true,lowRising:true,atrPct:.5}};}
const snapshot=rows=>({completedAt:now-30000,candidates:rows});
test('at most three unique qualifying coins, with maintaining before pullback',()=>{
 const rows=[row('KRW-B','pullback',99),row('KRW-A'),row('KRW-C'),row('KRW-D'),row('KRW-A')];
 const picks=R.select(snapshot(rows),now).picks;
 assert.deepEqual(picks.map(r=>r.market),['KRW-A','KRW-C','KRW-D']);assert.ok(picks.every(r=>r.recommendation.reasons.length>=3));
});
test('weakening, follow-up, sparse, overheating and stopped volume are excluded',()=>{
 const rows=[row('KRW-W','weakening'),{...row('KRW-F'),followUp:true},row('KRW-S'),row('KRW-H'),row('KRW-V')];
 rows[2].detail.active15=4;rows[3].detail.extensionAtr=5;rows[4].detail.continuation=false;
 const result=R.select(snapshot(rows),now);assert.equal(result.picks.length,0);assert.ok(result.hold);assert.equal(Object.values(result.rejected).reduce((a,b)=>a+b,0),5);
});
test('old snapshot, old individual candles and failed lookup never become recommendations',()=>{
 assert.equal(R.select({...snapshot([row()]),completedAt:now-8*60000},now).picks.length,0);
 const old=row();old.detail.cutoff=now-8*60000;
 assert.equal(R.select(snapshot([old]),now).picks.length,0);
 assert.equal(R.select(snapshot([row()]),now,true).picks.length,0);
});
test('missing volume/relative strength/VWAP data and pegged assets are not guessed',()=>{
 const rows=[row('KRW-USDC'),row('KRW-M'),row('KRW-N'),row('KRW-O')];
 rows[1].detail.relativeBtc15=null;rows[2].detail.vwap20=NaN;rows[3].detail.active15=undefined;
 assert.equal(R.select(snapshot(rows),now).picks.length,0);
});
test('a qualified pullback explains that breakout resumption is unconfirmed',()=>{
 const result=R.select(snapshot([row('KRW-P','pullback')]),now);
 assert.equal(result.picks.length,1);assert.match(result.picks[0].recommendation.cautions[0],/아닙니다/);
});


test('learned model controls ranking immediately without relaxing candidate eligibility',()=>{
 const rows=[row('KRW-A','maintaining',100),row('KRW-B','pullback',10),row('KRW-C','maintaining',99),row('KRW-D','maintaining',98),row('KRW-E','weakening')];
 rows.forEach((r,i)=>{r.detail.returns[1]=i;r.detail.returns[5]=.3;});
 const model={weights:[0,1,...Array(11).fill(0)],mean:Array(12).fill(0),scale:Array(12).fill(1)};
 const picks=R.select(snapshot(rows),now,false,model).picks;
 assert.deepEqual(picks.map(r=>r.market),['KRW-D','KRW-C','KRW-B']);
});
