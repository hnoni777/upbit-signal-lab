// node scripts/replay_sequence.cjs candles.json [report.json]
// Input: {"KRW-XXX": [Upbit 1-minute OHLCV rows, ...], ...}. Never 15-minute bars.
// Final chronological 20% is a holdout; thresholds are fixed in sequence.js before replay.
const fs=require('node:fs'),S=require('../sequence.js');
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const markets=Object.entries(input).map(([market,rows])=>({market,rows:rows.sort((a,b)=>S.time(a)-S.time(b))}));
const times=[...new Set(markets.flatMap(m=>m.rows.map(S.time)))].sort((a,b)=>a-b);
const boundary=times[Math.floor(times.length*.8)];
const groups=new Map();
for(const {market,rows} of markets){
 for(let i=60;i+30<=rows.length;i++){
  const cutoff=S.time(rows[i]);if(cutoff<boundary)continue;
  const signal=S.detect(rows.slice(i-60,i),cutoff),outcome=S.outcome(rows.slice(i-1,i+31),cutoff,S.time(rows.at(-1))+60000);
  // Both strategies use precisely the same observable liquidity and data universe.
  if(!outcome||!signal.f||['illiquid','extended'].includes(signal.stage))continue;
  if(!groups.has(cutoff))groups.set(cutoff,[]);
  groups.get(cutoff).push({market,signal,outcome});
 }
}
function evaluate(strategy){
 const last=new Map(),picks=[];let slots=0;
 for(const [cutoff,rows] of [...groups].sort((a,b)=>a[0]-b[0])){
  if(rows.length<5)continue;slots++;
  const eligible=rows.filter(r=>cutoff-(last.get(r.market)||0)>=30*60000);
  const ranked=(strategy==='sequence'?eligible.filter(r=>r.signal.stage==='confirmed'):eligible).sort((a,b)=>strategy==='sequence'?b.signal.f.score-a.signal.f.score:b.signal.f.triggerRatio-a.signal.f.triggerRatio).slice(0,5);
  for(const r of ranked){last.set(r.market,cutoff);picks.push({...r,cutoff});}
 }
 return {slots,picks:picks.length,target:picks.filter(r=>r.outcome.result==='target').length,stop:picks.filter(r=>r.outcome.result==='stop').length,ambiguous:picks.filter(r=>r.outcome.result==='ambiguous').length,hitRate:picks.length?picks.filter(r=>r.outcome.result==='target').length/picks.length:null,meanNetPct:picks.length?picks.reduce((s,r)=>s+r.outcome.net,0)/picks.length:null,details:picks.map(r=>({market:r.market,cutoff:r.cutoff,...r.outcome}))};
}
const report={version:51,config:S.CONFIG,boundary:boundary?new Date(boundary).toISOString():null,marketCount:markets.length,sequence:evaluate('sequence'),volumeBaseline:evaluate('volume'),note:'Fixed-rule holdout replay; no calibrated probability. Signals use closed bars; entry uses next minute open. OHLC ordering ambiguity counted conservatively. .3% cost is a stress assumption, not measured execution cost. Overlapping cross-market picks are not a portfolio simulation. Re-tuning after viewing holdout invalidates it.'};
const text=JSON.stringify(report,null,2);if(process.argv[3])fs.writeFileSync(process.argv[3],text);else console.log(text);
