const test=require('node:test'),assert=require('node:assert/strict');
const {delaySeconds}=require('../scripts/continue_scan.cjs');
test('normal continuation spaces scan starts approximately five minutes apart',()=>{assert.equal(delaySeconds(1000,71000,'workflow_dispatch'),230);});
test('deployment performs one immediate unattended handoff',()=>{assert.equal(delaySeconds(1000,71000,'push'),0);});
test('slow/failed jobs retain a retry pause and intervals have an upper bound',()=>{assert.equal(delaySeconds(1000,601000,'workflow_dispatch'),30);assert.ok(delaySeconds(1000,2000,'workflow_dispatch',99999)<=600);});
