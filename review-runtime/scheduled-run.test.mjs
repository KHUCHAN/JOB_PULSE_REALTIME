import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./scheduled-run.py',import.meta.url));
async function lane({hold,inflight,reconcileExit=0}){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'scheduled-run-')),base=path.join(home,'Library/Application Support/Job Pulse'),code=path.join(base,'repo/review-runtime'),log=path.join(home,'calls.log');
 for(const d of [code,path.join(base,'review-runtime'),path.join(base,'runtime-root')])await fs.mkdir(d,{recursive:true});
 const fake=(name,exit)=>fs.writeFile(path.join(code,name),`import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(log)},${JSON.stringify(name+'\n')});process.exit(${exit});`);
 await fake('reconcile.mjs',reconcileExit);await fake('live-run.mjs',0);
 if(hold!==undefined)await fs.writeFile(path.join(base,'runtime-root/live-hold.json'),hold);
 if(inflight!==undefined)await fs.writeFile(path.join(base,'runtime-root/live-inflight.json'),inflight);
 const run=spawnSync('/usr/local/bin/python3',[script,'live'],{env:{...process.env,HOME:home,JOB_PULSE_NODE:process.execPath},encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 const calls=(await fs.readFile(log,'utf8')).trim().split('\n');await fs.rm(home,{recursive:true,force:true});return calls;
}
const both=['reconcile.mjs','live-run.mjs'],liveOnly=['live-run.mjs'];
test('a clean lane starts the live run without reconciling',async()=>{
 assert.deepEqual(await lane({}),liveOnly);
 assert.deepEqual(await lane({hold:'{"resolved":true}',inflight:'{"status":"completed"}'}),liveOnly);
});
test('an unresolved hold or unfinished attempt reconciles first',async()=>{
 assert.deepEqual(await lane({hold:'{"reason":"timeout"}'}),both);
 assert.deepEqual(await lane({inflight:'{"status":"attempting"}'}),both);
 assert.deepEqual(await lane({hold:'not json'}),both);
});
test('a failed reconcile leaves the decision to the live run, which holds by itself',async()=>{
 assert.deepEqual(await lane({hold:'{"reason":"timeout"}',reconcileExit:1}),both);
});
