'use strict';
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
function delaySeconds(started,now,event,interval=300){
 // One immediate handoff after a code deployment verifies unattended dispatch.
 if(event==='push')return 0;
 return Math.max(30,Math.min(600,interval)-Math.max(0,Math.floor((now-started)/1000)));
}
function control(repo){
 const body=execFileSync('gh',['api','repos/'+repo+'/contents/.github/server-control.json?ref=main'],{encoding:'utf8',stdio:['ignore','pipe','inherit']});
 const payload=JSON.parse(body);return JSON.parse(Buffer.from(payload.content,'base64').toString('utf8'));
}
async function main(){
 const repo=process.env.GITHUB_REPOSITORY;if(!repo)throw Error('GITHUB_REPOSITORY missing');
 let settings=control(repo);if(!settings.enabled){console.log('Scanner disabled; no next run');return;}
 const started=Number(process.env.SCAN_STARTED_AT)||Date.now();
 const delay=delaySeconds(started,Date.now(),process.env.GITHUB_EVENT_NAME,settings.intervalSeconds);
 console.log('Next analysis dispatch after',delay,'seconds');
 await new Promise(resolve=>setTimeout(resolve,delay*1000));
 settings=control(repo);if(!settings.enabled){console.log('Scanner disabled while waiting');return;}
 const input=JSON.stringify({ref:'main',inputs:{chained:'true'}});
 execFileSync('gh',['api','--method','POST','repos/'+repo+'/actions/workflows/server-scan.yml/dispatches','--input','-'],{input,stdio:['pipe','inherit','inherit']});
 console.log('Next workflow dispatched');
}
module.exports={delaySeconds};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
