'use strict';
(function(root){
 const MAX_AGE=7*60000,stable=new Set(['USDT','USDC','DAI','USDE','USD1','USDS','FDUSD','TUSD','PYUSD','USDD']);
 function features(row){
  const d=row.detail;if(!d)return null;
  const x=[d.returns?.[1],d.returns?.[3],d.returns?.[5],d.returns?.[15],d.relativeBtc15,Math.log1p(d.recentRatio),d.pullback,d.atrPct,d.extensionAtr,d.active15/15,d.aboveTrend?1:0,d.hold?1:0];
  return x.every(Number.isFinite)?x.map(v=>Math.max(-20,Math.min(20,v))):null;
 }
 function learnedScore(model,row){
  const x=features(row);
  if(!x||!model||!Array.isArray(model.weights)||model.weights.length!==x.length+1||model.mean?.length!==x.length||model.scale?.length!==x.length||!model.weights.every(Number.isFinite)||!model.mean.every(Number.isFinite)||!model.scale.every(v=>Number.isFinite(v)&&v>0))return null;
  const z=model.weights[0]+x.reduce((s,v,j)=>s+(v-model.mean[j])/model.scale[j]*model.weights[j+1],0);
  return 1/(1+Math.exp(-Math.max(-30,Math.min(30,z))));
 }
 function select(snapshot,now=Date.now(),sourceFailed=false,model=null){
  if(!snapshot)return {picks:[],hold:'서버 결과를 불러오는 중입니다.',rejected:{}};
  if(sourceFailed)return {picks:[],hold:'자료 재조회에 실패해 우선 검토 후보를 보류합니다.',rejected:{}};
  if(!Number.isFinite(snapshot.completedAt)||now-snapshot.completedAt>MAX_AGE||snapshot.completedAt>now+30000||snapshot.stale)return {picks:[],hold:'서버 자료가 오래됐거나 시각을 확인할 수 없어 선정을 보류합니다.',rejected:{}};
  const rejected={},eligible=[];
  const reject=reason=>{rejected[reason]=(rejected[reason]||0)+1;};
  for(const row of snapshot.candidates||[]){
   const d=row.detail;
   if(!d||!Number.isFinite(d.cutoff)||now-d.cutoff>MAX_AGE||d.cutoff>now+30000||row.refreshFailed){reject('자료 부족·재확인 지연');continue;}
   if(d.excluded||stable.has(String(row.market).replace('KRW-',''))){reject('급등 검토 대상 제외');continue;}
   if(row.followUp||!['maintaining','pullback'].includes(d.status)){reject('흐름 미확인·최초 조건 이탈');continue;}
   if(!Number.isFinite(d.active15)||d.active15<10||!Number.isFinite(d.baselinePerMinute)||d.baselinePerMinute<100000){reject('거래가 뜸하거나 증가 배수 과장 우려');continue;}
   if(!d.continuation||!Number.isFinite(d.recentRatio)||d.recentRatio<1.3){reject('거래 증가 지속 미확인');continue;}
   if(!d.aboveTrend||!Number.isFinite(d.returns?.[3])||d.returns[3]<0||!Number.isFinite(d.returns?.[15])||d.returns[15]<=0){reject('단기 가격 흐름 미확인');continue;}
   if(!Number.isFinite(d.relativeBtc15)||d.relativeBtc15<0){reject('시장 대비 강도 부족·자료 없음');continue;}
   if(!Number.isFinite(d.extensionAtr)||d.extensionAtr>3||!Number.isFinite(d.pullback)||d.pullback<-1.5){reject('가격 이격·되밀림 부담');continue;}
   if(!Number.isFinite(d.price)||d.price<=0||!Number.isFinite(d.vwap20)||d.price<d.vwap20){reject('거래 평균 가격 유지 미확인');continue;}
   if(d.status==='maintaining'&&!d.hold){reject('돌파 구간 유지 미확인');continue;}
   if(d.status==='pullback'&&!d.lowRising){reject('눌림 저점 유지 미확인');continue;}
   const reasons=[
    d.status==='maintaining'?'직전 돌파 구간을 유지하는 흐름':'고점에서 눌린 뒤 최근 저점이 유지되는 흐름',
    '최근 3분 거래 증가가 이어지고 15분 중 '+d.active15+'분에 실제 거래 발생',
    '단기 이동평균 상승 정렬·20분 거래 평균 가격 위',
    '최근 15분 비트코인보다 뒤처지지 않는 흐름'
   ];
   const cautions=d.status==='pullback'?['돌파 재개가 확인된 상태는 아닙니다.']:['돌파 구간 유지가 깨지면 선정 근거가 약해집니다.'];
   if(d.atrPct>=1)cautions.push('최근 분 단위 가격 변동폭이 큽니다.');
   eligible.push({...row,recommendation:{reasons,cautions}});
  }
  eligible.sort((a,b)=>(model?(learnedScore(model,b)??0)-(learnedScore(model,a)??0):0)||(b.detail.status==='maintaining')-(a.detail.status==='maintaining')||(b.detail.quality||0)-(a.detail.quality||0)||String(a.market).localeCompare(String(b.market)));
  const seen=new Set();
  const unique=eligible.filter(r=>{if(seen.has(r.market))return false;seen.add(r.market);return true;});
  return {picks:unique.slice(0,3),hold:unique.length?'':'거래 지속과 가격 흐름을 함께 충족하는 후보가 없어 지금은 선정을 보류합니다.',rejected};
 }
 const api={select,features,learnedScore};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CandidateRecommendations=api;
})(typeof globalThis!=='undefined'?globalThis:this);
