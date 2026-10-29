'use strict';
// v58: immediately retrain ranking when completed prospective outcomes change.
const {createHash}=require('node:crypto');
const S=require('./sequence.js'),R=require('./recommend.js');
const VERSION=1,DAY=86400000,MINUTE=60000;
const features=R.features;
function state(){return {version:VERSION,observations:[],recommendations:[],champion:null,lastAttemptDay:null,promotions:[],stats:{resolved:0,missing:0},status:'collecting'};}
function observe(learning,snapshot){
 const selected=R.select(snapshot,snapshot.completedAt,false,learning.champion).picks,ids=new Set(selected.map(r=>r.market));
 learning.recommendations??=[];
 for(const r of selected){
  const id=r.market+'|'+snapshot.completedAt;if(learning.recommendations.some(x=>x.id===id))continue;
  learning.recommendations.push({id,market:r.market,observedAt:snapshot.completedAt,entryCutoff:Math.floor(snapshot.completedAt/MINUTE)*MINUTE+MINUTE,x:features(r),modelId:learning.champion?.id||'fixed-v55'});
 }
 for(const row of snapshot.candidates){
  const x=features(row);if(!x||row.refreshFailed||row.detail.excluded||snapshot.completedAt-row.cutoff>3*MINUTE)continue;
  const slot=Math.floor(snapshot.cutoff/(30*MINUTE));
  if(learning.observations.some(r=>r.market===row.market&&r.slot===slot))continue;
  // Eligibility is evaluated independently: do not label all non-TOP3 coins as failures.
  const eligible=R.select({...snapshot,candidates:[row]},snapshot.completedAt).picks.length===1;
  const pred=learning.champion?predict(learning.champion,x):null;
  learning.observations.push({id:row.market+'|'+slot,market:row.market,slot,x,eligible,recommended:ids.has(row.market),quality:row.detail.quality,status:row.detail.status,observedAt:snapshot.completedAt,entryCutoff:Math.floor(snapshot.completedAt/MINUTE)*MINUTE+MINUTE,modelPrediction:pred,modelId:learning.champion?.id||'fixed-v55'});
 }
}
function settle(learning,market,rows,asOf){
 for(const r of [...learning.observations,...(learning.recommendations||[])].filter(r=>r.market===market&&!r.outcome&&!r.missing&&r.entryCutoff+30*MINUTE<=asOf)){
  const o=S.outcome(rows,r.entryCutoff,asOf);
  if(o){r.outcome=o;learning.stats.resolved++;}
  // Keep missing windows unknown; a separate historical fetch can recover them.
 }
}
function train(rows){
 const n=rows[0].x.length,mean=Array(n).fill(0),scale=Array(n).fill(0);
 for(const r of rows)for(let j=0;j<n;j++)mean[j]+=r.x[j]/rows.length;
 for(const r of rows)for(let j=0;j<n;j++)scale[j]+=(r.x[j]-mean[j])**2/rows.length;
 for(let j=0;j<n;j++)scale[j]=Math.sqrt(scale[j])>1e-8?Math.sqrt(scale[j]):1;
 const weights=Array(n+1).fill(0),xs=rows.map(r=>[1,...r.x.map((v,j)=>(v-mean[j])/scale[j])]);
 for(let iter=0;iter<180;iter++){
  const grad=Array(n+1).fill(0);
  for(let i=0;i<rows.length;i++){
   const z=xs[i].reduce((s,v,j)=>s+v*weights[j],0),p=1/(1+Math.exp(-Math.max(-30,Math.min(30,z)))),y=rows[i].outcome.result==='target'?1:0;
   for(let j=0;j<=n;j++)grad[j]+=(p-y)*xs[i][j]/rows.length;
  }
  for(let j=0;j<=n;j++)weights[j]-=.08*(grad[j]+(j?.02*weights[j]:0));
 }
 return {version:VERSION,weights,mean,scale};
}
function predict(model,x){
 if(!model||x.length!==model.mean.length)return null;
 const z=model.weights[0]+x.reduce((s,v,j)=>s+(v-model.mean[j])/model.scale[j]*model.weights[j+1],0);
 // Ranking score only: not a calibrated probability shown to the user.
 return 1/(1+Math.exp(-Math.max(-30,Math.min(30,z))));
}
function evaluate(rows,model){
 const groups=new Map();for(const r of rows){if(!groups.has(r.slot))groups.set(r.slot,[]);groups.get(r.slot).push(r);}
 let count=0,target=0,net=0,groupsUsed=0;
 for(const group of groups.values()){
  if(group.length<3)continue;groupsUsed++;
  const sorted=group.slice().sort((a,b)=>model?predict(model,b.x)-predict(model,a.x):((b.status==='maintaining')-(a.status==='maintaining')||b.quality-a.quality));
  for(const r of sorted.slice(0,3)){count++;target+=r.outcome.result==='target';net+=r.outcome.net;}
 }
 return {count,groups:groupsUsed,hitRate:count?target/count:null,meanNet:count?net/count:null};
}
function update(learning,now=Date.now()){
 // Only frozen, eligible observations with completed, known outcomes enter training.
 // Repeated TOP3 recommendation rows and unresolved/missing rows are not samples.
 const resolved=learning.observations.filter(r=>r.eligible&&!r.missing&&r.outcome&&
  Number.isFinite(r.observedAt)&&r.observedAt<=now&&r.observedAt>=now-90*DAY&&
  Number.isFinite(r.outcome.end)&&r.outcome.end<=now&&r.outcome.end>r.observedAt&&
  ['target','stop','timeout','ambiguous'].includes(r.outcome.result)&&
  Array.isArray(r.x)&&r.x.length===12&&r.x.every(Number.isFinite)
 ).sort((a,b)=>a.observedAt-b.observedAt||String(a.id).localeCompare(String(b.id)));
 const positives=resolved.filter(r=>r.outcome.result==='target').length;
 learning.mode='immediate';
 learning.evidence={resolved:resolved.length,days:resolved.length?Math.floor((now-resolved[0].observedAt)/DAY):0,positives,negatives:resolved.length-positives,windowDays:90};
 if(!resolved.length){learning.status=learning.champion?'immediate_waiting':'collecting';return;}
 const inputSignature=createHash('sha256').update(JSON.stringify(resolved.map(r=>[r.id,r.observedAt,r.outcome.end,r.outcome.result,r.x]))).digest('hex');
 // No daily throttle or minimum-day/count/holdout gates. Unchanged inputs keep the model.
 if(learning.champion?.policy==='immediate-v58'&&learning.inputSignature===inputSignature){learning.status='immediate_applied';return;}
 const model=train(resolved);
 if(![...model.weights,...model.mean,...model.scale].every(Number.isFinite)||model.scale.some(v=>v<=0)){
  learning.status='training_failed';return;
 }
 const id='immediate-'+inputSignature.slice(0,12);
 learning.champion={...model,id,policy:'immediate-v58',validated:false,trainedAt:now,
  trainedFrom:resolved[0].observedAt,trainedThrough:Math.max(...resolved.map(r=>r.outcome.end)),
  trainingSamples:resolved.length,positives,negatives:resolved.length-positives};
 learning.inputSignature=inputSignature;learning.lastUpdatedAt=now;
 // Old held-out evaluation must never appear as validation of this immediate model.
 learning.lastEvaluation=null;
 learning.promotions??=[];
 learning.promotions.push({id,at:now,mode:'immediate',validated:false,samples:resolved.length});
 learning.promotions=learning.promotions.slice(-100);
 learning.status='immediate_applied';
}
function summary(l){return {version:VERSION,mode:l.mode||'immediate',status:l.status,observations:l.observations.length,resolved:l.stats.resolved,recommended:(l.recommendations||[]).length,recommendedEvaluated:(l.recommendations||[]).filter(r=>r.outcome).length,champion:l.champion,evidence:l.evidence||null,lastUpdatedAt:l.lastUpdatedAt||null,lastEvaluation:l.lastEvaluation||null,promotions:l.promotions.slice(-10),rollbacks:(l.rollbacks||[]).slice(-10),note:'평가 완료 기록이 늘면 즉시 재학습해 후보 순위에 적용합니다. 검증 전 모델이며 수익성 개선이 확인된 것은 아닙니다.'};}
function prune(l){
 l.recommendations=(l.recommendations||[]).filter(r=>!r.outcome&&!r.missing).concat((l.recommendations||[]).filter(r=>r.outcome||r.missing).slice(-20000));
 const pending=l.observations.filter(r=>!r.outcome&&!r.missing),done=l.observations.filter(r=>r.outcome||r.missing);
 l.observations=[...pending,...done.filter(r=>r.eligible).slice(-50000),...done.filter(r=>!r.eligible).slice(-5000)].sort((a,b)=>a.observedAt-b.observedAt);
}
module.exports={prune,state,observe,settle,train,predict,evaluate,update,summary,features};

