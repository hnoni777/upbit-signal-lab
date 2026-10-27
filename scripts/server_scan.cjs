'use strict';
const fs=require('node:fs');
const S=require('../sequence.js');
const D=require('../detail.js');
const MINUTE=60000, API=process.env.UPBIT_API_BASE||'https://api.upbit.com/v1';
const emptyStats=()=>({evaluated:0,target:0,stop:0,ambiguous:0,timeout:0,missing:0,netTotal:0});
function initial(){return {schema:52,runCount:0,history:[],totals:{watch:emptyStats(),confirmed:emptyStats()}};}
function readState(path){
 if(!fs.existsSync(path))return initial();
 const state=JSON.parse(fs.readFileSync(path,'utf8'));
 if(state.schema!==52||!Array.isArray(state.history)||!state.totals)throw Error('Unsupported server state; refusing to erase history');
 return state;
}
function recordOutcome(state,record,outcome){
 if(record.outcome||record.expired)return;
 const stats=(record.strategyVersion===54?state.detailTotals:state.totals)[record.stage];
 if(outcome){record.outcome=outcome;stats.evaluated++;stats[outcome.result]++;stats.netTotal+=outcome.net;}
 else {record.expired=true;stats.missing++;}
}
async function scan(previous,{get,now=Date.now,onProgress=()=>{}}){
 const state=structuredClone(previous),startedAt=now(),cutoff=Math.floor(startedAt/MINUTE)*MINUTE;
 state.detailTotals??={watch:emptyStats(),confirmed:emptyStats()};
 const previousRows=new Map((previous.snapshot?.candidates||[]).filter(r=>cutoff-r.cutoff<=30*MINUTE).map(r=>[r.market,r]));
 const barCache=new Map();
 const markets=(await get('/market/all?isDetails=false')).filter(m=>m.market.startsWith('KRW-'));
 if(!markets.length)throw Error('No KRW markets; previous snapshot preserved');
 const counts={requested:markets.length,valid:0,missing:0,illiquid:0,extended:0,quiet:0,errors:0};
 const candidates=[],errorMarkets=[];let next=0,finished=0;
 // Same production detector as browser and historical replay; no retraining.
 async function worker(){while(next<markets.length){
  const m=markets[next++];
  try{
   const rows=await get('/candles/minutes/1?market='+encodeURIComponent(m.market)+'&count=200&to='+encodeURIComponent(new Date(cutoff).toISOString()));
   barCache.set(m.market,rows);
   for(const record of state.history.filter(r=>r.market===m.market&&!r.outcome&&!r.expired&&r.entryCutoff+30*MINUTE<=cutoff)){
    let result=S.outcome(rows,record.entryCutoff,cutoff);
    if(!result){
     // Recover delayed runs using the original evaluation window, rather than
     // mislabeling missing observations or re-entering at today's price.
     const end=record.entryCutoff+30*MINUTE;
     const archived=await get('/candles/minutes/1?market='+encodeURIComponent(m.market)+'&count=80&to='+encodeURIComponent(new Date(end).toISOString()));
     result=S.outcome(archived,record.entryCutoff,end);
    }
    recordOutcome(state,record,result);
   }
   const signal=S.detect(rows,cutoff);
   if(signal.stage==='missing')counts.missing++;
   else{
    counts.valid++;
    if(['watch','confirmed'].includes(signal.stage))candidates.push({market:m.market,name:m.korean_name||m.market,signal,cutoff,checkedAt:now()});
    else {
     counts[signal.stage]++;
     const old=previousRows.get(m.market);
     if(old&&cutoff-(old.firstSeen||old.cutoff)<=30*MINUTE)candidates.push({market:m.market,name:m.korean_name||m.market,signal:{...signal,stage:'watch'},cutoff,checkedAt:now(),followUp:true,firstSeen:old.firstSeen||old.cutoff});
    }
   }
  }catch(e){counts.errors++;errorMarkets.push(m.market);}
  finally{finished++;onProgress({finished,total:markets.length,market:m.market});}
 }}
 await Promise.all(Array.from({length:Math.min(3,markets.length)},worker));
 if(counts.errors>markets.length*.2)throw Error('Too many API failures ('+counts.errors+'/'+markets.length+'); previous snapshot preserved');
 // Recheck all detected/follow-up candidates at the same newer closed-minute cutoff.
 const detailCutoff=Math.floor(now()/MINUTE)*MINUTE;
 let refreshIndex=0,refreshErrors=0;
 async function refreshWorker(){while(refreshIndex<candidates.length){
  const row=candidates[refreshIndex++];
  row.firstSeen??=previousRows.get(row.market)?.firstSeen||row.cutoff;
  try{
   if(detailCutoff>cutoff){
    const rows=await get('/candles/minutes/1?market='+encodeURIComponent(row.market)+'&count=200&to='+encodeURIComponent(new Date(detailCutoff).toISOString()));
    barCache.set(row.market,rows);const latest=S.detect(rows,detailCutoff);
    row.cutoff=detailCutoff;row.checkedAt=now();
    if(['watch','confirmed'].includes(latest.stage)){row.signal=latest;row.followUp=false;}
    else {row.signal={...latest,stage:'watch'};row.followUp=true;}
   }
  }catch(e){row.refreshFailed=true;refreshErrors++;}
 }}
 await Promise.all(Array.from({length:Math.min(3,candidates.length)},refreshWorker));
 // Relative strength uses a BTC candle with exactly the same cutoff as the candidate.
 const btcByCutoff=new Map();
 for(const t of new Set(candidates.map(r=>r.cutoff))){
  try{
   const rows=t===cutoff?barCache.get('KRW-BTC'):await get('/candles/minutes/1?market=KRW-BTC&count=200&to='+encodeURIComponent(new Date(t).toISOString()));
   const detail=rows?D.analyze(rows,t):null;btcByCutoff.set(t,detail?.returns[15]??null);
  }catch(e){btcByCutoff.set(t,null);}
 }
 let excluded=0;
 const detailed=candidates.filter(row=>{
  row.detail=D.analyze(barCache.get(row.market)||[],row.cutoff,{market:row.market,btcReturn:btcByCutoff.get(row.cutoff)??null,previous:previousRows.get(row.market)?.detail});
  if(!row.detail||row.detail.excluded){excluded++;return false;}
  if(row.followUp)row.detail.status='weakening';
  return true;
 });
 const completedAt=now(),stale=completedAt-cutoff>3*MINUTE;
 for(const row of detailed){
  const stage=row.signal.stage;
  if(row.followUp||row.refreshFailed||row.detail.status==='weakening'||completedAt-row.cutoff>3*MINUTE)continue;
  if(!state.history.some(r=>r.strategyVersion===54&&r.market===row.market&&r.stage===stage&&Math.abs(row.cutoff-r.cutoff)<30*MINUTE))state.history.push({id:row.market+'|54|'+stage+'|'+row.cutoff,strategyVersion:54,market:row.market,name:row.name,stage,cutoff:row.cutoff,observedAt:completedAt,entryCutoff:Math.floor(completedAt/MINUTE)*MINUTE+MINUTE,score:row.signal.f.score,detailStatus:row.detail.status});
 }
 const listed=new Set(markets.map(m=>m.market));
 for(const r of state.history.filter(r=>!r.outcome&&!r.expired&&!listed.has(r.market)&&cutoff-r.entryCutoff>24*60*MINUTE))recordOutcome(state,r,null);
 const completed=state.history.filter(r=>r.outcome||r.expired).slice(-1000),pending=state.history.filter(r=>!r.outcome&&!r.expired);
 state.history=[...completed,...pending].sort((a,b)=>a.cutoff-b.cutoff);
 state.runCount++;state.completedAt=completedAt;
 state.quoteSource=API==='https://api.upbit.com/v1'?'upbit-direct':'custom';
 state.analysisVersion=54;
 state.snapshot={cutoff,detailCutoff,startedAt,completedAt,stale,counts,errorMarkets,refreshErrors,excluded,candidates:detailed.sort((a,b)=>b.detail.quality-a.detail.quality)};
 state.schedule={requestedMinutes:5,provider:'GitHub Actions',exactTiming:false};
 return state;
}
function makeGetter(){
 let queue=Promise.resolve();const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 return async path=>{
  for(let attempt=0;attempt<3;attempt++){
   queue=queue.then(()=>sleep(180));await queue;
   try{
    const response=await fetch(API+path,{signal:AbortSignal.timeout(12000),headers:{'Accept':'application/json','User-Agent':'upbit-signal-lab-server/52'}});
    if(!response.ok)throw Error('API '+response.status);
    const rows=await response.json();if(!Array.isArray(rows))throw Error('Invalid API array');return rows;
   }catch(e){if(attempt===2)throw e;await sleep((attempt+1)*1000);}
  }
 };
}
async function main(){
 const input=process.argv[2]||'data/server-state.json',output=process.argv[3]||input;
 const state=await scan(readState(input),{get:makeGetter(),onProgress:p=>{if(p.finished%50===0||p.finished===p.total)console.log('Scanned',p.finished,'/',p.total);}});
 fs.mkdirSync(require('node:path').dirname(output),{recursive:true});
 fs.writeFileSync(output+'.tmp',JSON.stringify(state));fs.renameSync(output+'.tmp',output);
 console.log(JSON.stringify({runCount:state.runCount,cutoff:state.snapshot.cutoff,counts:state.snapshot.counts,watch:state.snapshot.candidates.filter(r=>r.signal.stage==='watch').length,confirmed:state.snapshot.candidates.filter(r=>r.signal.stage==='confirmed').length}));
}
module.exports={initial,scan,readState,recordOutcome};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
