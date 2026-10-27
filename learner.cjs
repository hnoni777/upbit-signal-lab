'use strict';
// Learn only from prospectively stored inputs. Promotion uses untouched later days.
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
  if(!eligible)continue;
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
 const today=Math.floor(now/DAY);
 const resolved=learning.observations.filter(r=>r.eligible&&r.outcome&&r.outcome.end<=now&&r.observedAt>=now-90*DAY).sort((a,b)=>a.observedAt-b.observedAt);
 const start=resolved[0]?.observedAt;
 learning.evidence={resolved:resolved.length,required:400,days:start?Math.floor((now-start)/DAY):0,requiredDays:28};
 if(learning.lastAttemptDay===today)return;learning.lastAttemptDay=today;
 if(learning.champion){
  const forward=resolved.filter(r=>r.observedAt>learning.champion.trainedAt);
  const current=evaluate(forward,learning.champion),fixed=evaluate(forward,null);
  if(current.count>=60&&current.groups>=20&&new Set(forward.map(r=>Math.floor(r.observedAt/DAY))).size>=7&&current.meanNet<fixed.meanNet-.2){
   learning.rollbacks??=[];learning.rollbacks.push({id:learning.champion.id,at:now,current,fixed});learning.champion=null;learning.status='rolled_back';return;
  }
 }
 if(resolved.length<400||!start||now-start<28*DAY){learning.status='collecting';learning.evidence={resolved:resolved.length,required:400,days:start?Math.floor((now-start)/DAY):0,requiredDays:28};return;}
 const dates=[...new Set(resolved.map(r=>Math.floor(r.observedAt/DAY)))];
 const trainEnd=dates[Math.floor(dates.length*.6)]*DAY,validationEnd=dates[Math.floor(dates.length*.8)]*DAY;
 // A full outcome horizon is purged at each date boundary.
 const fit=resolved.filter(r=>r.outcome.end<trainEnd),validation=resolved.filter(r=>r.observedAt>=trainEnd&&r.outcome.end<validationEnd);
 const positives=fit.filter(r=>r.outcome.result==='target').length;
 if(fit.length<150||positives<20||fit.length-positives<20||validation.length<60){learning.status='insufficient_classes';return;}
 const challenger=train(fit),v=evaluate(validation,challenger),baseline=evaluate(validation,learning.champion);
 if(v.count<30||v.groups<10||v.meanNet<=baseline.meanNet+.1||v.hitRate<baseline.hitRate){learning.status='challenger_rejected';learning.lastEvaluation={validation:v,baseline};return;}
 // Never reuse a test record exposed by any prior model selection decision.
 const test=resolved.filter(r=>r.observedAt>=Math.max(validationEnd,learning.testWatermark||0));
 const score=evaluate(test,challenger),incumbent=evaluate(test,learning.champion);
 if(score.count<60||score.groups<20||new Set(test.map(r=>Math.floor(r.observedAt/DAY))).size<7){learning.status='fresh_holdout_needed';return;}
 learning.testWatermark=Math.max(...test.map(r=>r.outcome.end));
 learning.lastEvaluation={validation:v,baseline,test:score,incumbent,testFrom:Math.min(...test.map(r=>r.observedAt)),testTo:learning.testWatermark};
 if(score.meanNet<=0||score.meanNet<incumbent.meanNet+.15||score.hitRate<incumbent.hitRate){learning.status='holdout_rejected';return;}
 const id='adaptive-'+today;learning.champion={...challenger,id,trainedAt:now,trainedThrough:trainEnd,validationThrough:validationEnd,testThrough:learning.testWatermark};
 learning.promotions.push({id,at:now,test:score,incumbent});learning.status='promoted';
}
function summary(l){return {version:VERSION,status:l.status,observations:l.observations.length,resolved:l.stats.resolved,recommended:(l.recommendations||[]).length,recommendedEvaluated:(l.recommendations||[]).filter(r=>r.outcome).length,champion:l.champion,evidence:l.evidence||null,lastEvaluation:l.lastEvaluation||null,promotions:l.promotions.slice(-10),rollbacks:(l.rollbacks||[]).slice(-10),note:'조건을 통과한 후보 사이의 순위 학습입니다. 확률 보정과 실제 체결 수익 검증은 아닙니다.'};}
function prune(l){l.recommendations=(l.recommendations||[]).filter(r=>!r.outcome&&!r.missing).concat((l.recommendations||[]).filter(r=>r.outcome||r.missing).slice(-20000));l.observations=l.observations.filter(r=>!r.outcome&&!r.missing).concat(l.observations.filter(r=>r.outcome||r.missing).slice(-50000)).sort((a,b)=>a.observedAt-b.observedAt);}
module.exports={prune,state,observe,settle,train,predict,evaluate,update,summary,features};
