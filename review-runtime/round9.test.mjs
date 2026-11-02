import {temporary,removeFixture} from './rehearsal-support.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {spawnSync} from 'node:child_process';
const code=path.resolve('review-runtime');
test('a second review POST for an attempted id is blocked even after network uncertainty',async()=>{
 const base=await temporary('job-pulse-round9-');try{
  const out=path.join(base,'evidence'),root=path.join(base,'root');await fs.mkdir(out);await fs.mkdir(root);await fs.writeFile(path.join(base,'automation.json'),'{"status":"PAUSED"}');await fs.writeFile(path.join(out,'heartbeat-test.json'),JSON.stringify({details:[{row:{id:'one',officialUrl:'https://example.org/one'}}]}));
  const script=`let sent=0;global.fetch=async()=>{sent++;throw Error('uncertain network outcome')};require(${JSON.stringify(path.join(code,'shadow-guard.cjs'))});(async()=>{const post=reviews=>fetch('http://127.0.0.1:9/api/pulse',{method:'POST',body:JSON.stringify({action:'submitCodexReview',dispatch:false,reviews:reviews.map(jobId=>({jobId}))})});for(const ids of [['one'],['one','two']])try{await post(ids)}catch{}if(sent!==1)throw Error('repeated POST reached transport: '+sent);})();`;
  const r=spawnSync(process.execPath,['-e',script],{encoding:'utf8',env:{...process.env,JOB_PULSE_REHEARSAL:'1',JOB_PULSE_REHEARSAL_BASE:base,JOB_PULSE_ENDPOINT:'http://127.0.0.1:9',JOB_PULSE_PROJECT_ROOT:root,JOB_PULSE_SHADOW_OUTPUT:out,JOB_PULSE_STAMP:'heartbeat-test',JOB_PULSE_LIVE_TRANSPORT:'authorized',JOB_PULSE_LIVE_STAGE:'persist'}});assert.equal(r.status,0,r.stderr);
 }finally{await removeFixture(base);}
});
test('crash while promoting source observations or checkpoints preserves complete prior JSON',async()=>{
 const source=await fs.readFile(path.join(code,'live-run.mjs'),'utf8'),start=source.indexOf(" await fs.mkdir(path.join(root,'review-runtime')"),end=source.indexOf('\n // Retain every scan',start);assert(start>=0&&end>start);
 for(const name of ['undated-source-observations.json','community-lookup-checkpoints.json']){
  const base=await temporary('job-pulse-round9-');try{
   const root=path.join(base,'root'),out=path.join(base,'out');await fs.mkdir(path.join(root,'review-runtime'),{recursive:true});await fs.mkdir(out);
   const target=path.join(root,'review-runtime',name),before='{"sources":{},"epochs":{},"old":true}';await fs.writeFile(target,before);await fs.writeFile(path.join(out,name),'{"new":true}');
   const script=`const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path');const root=${JSON.stringify(root)},report={out:${JSON.stringify(out)}},exists=p=>fs.access(p).then(()=>true,()=>false);fs.copyFile=async(src,dest)=>{await fs.writeFile(dest,'{');process.kill(process.pid,'SIGKILL')};sync.renameSync=()=>process.kill(process.pid,'SIGKILL');const {atomic}=require(${JSON.stringify(path.join(code,'atomic-state.cjs'))});(async()=>{${source.slice(start,end)}})();`;
   const r=spawnSync(process.execPath,['-e',script]);assert.equal(r.signal,'SIGKILL');assert.equal(await fs.readFile(target,'utf8'),before,name);
  }finally{await removeFixture(base);}
 }
});

test('dispatch receipt retains the identity supplied only by pending evidence',async()=>{
 const base=await temporary('job-pulse-round9-');try{
  const out=path.join(base,'out'),root=path.join(base,'root');await fs.mkdir(out);await fs.mkdir(root);await fs.writeFile(path.join(base,'automation.json'),'{"status":"PAUSED"}');await fs.writeFile(path.join(out,'heartbeat-test.json'),'{"details":[]}');
  const row={id:'pending',company:'Example',title:'Intern',location:'United States',officialUrl:'https://example.org/pending',requisitionId:'pending-req'};await fs.writeFile(path.join(out,'heartbeat-test-pending.json'),JSON.stringify({details:[{row}]}));
  const script=`global.fetch=async()=>new Response('{}');require(${JSON.stringify(path.join(code,'shadow-guard.cjs'))});fetch('http://127.0.0.1:9/api/pulse',{method:'POST',body:JSON.stringify({action:'dispatchCodexReviewBatch',jobIds:['pending']})});`;
  const r=spawnSync(process.execPath,['-e',script],{encoding:'utf8',env:{...process.env,JOB_PULSE_REHEARSAL:'1',JOB_PULSE_REHEARSAL_BASE:base,JOB_PULSE_ENDPOINT:'http://127.0.0.1:9',JOB_PULSE_PROJECT_ROOT:root,JOB_PULSE_SHADOW_OUTPUT:out,JOB_PULSE_STAMP:'heartbeat-test',JOB_PULSE_LIVE_TRANSPORT:'authorized',JOB_PULSE_LIVE_STAGE:'dispatch'}});assert.equal(r.status,0,r.stderr);
  const receipt=JSON.parse(await fs.readFile(path.join(out,(await fs.readdir(out)).find(n=>n.startsWith('post-attempt-')))));assert.deepEqual(receipt.identities,[row]);
 }finally{await removeFixture(base);}
});
test('pre-pause legacy state change does not poison transfer or rollback',async()=>{
 const base=await temporary('job-pulse-round9-');try{
  const script=`import importlib.util,json,hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('transition',${JSON.stringify(path.join(code,'transition.py'))});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.BASE=Path(${JSON.stringify(base)});m.ROOT=m.BASE/'runtime-root';m.RUNTIME=m.BASE/'review-runtime';m.REPO=Path(${JSON.stringify(path.dirname(code))})
rel=Path('.codex_tmp/codex-direct-db-gmail-state.json');original=m.BASE/'original';snap=m.BASE/'snapshot'
for p in [original,snap]:
 (p/rel).parent.mkdir(parents=True);(p/rel).write_text('{"records":{}}')
m.ROOT.mkdir();(m.ROOT/'current-snapshot').symlink_to(snap);m.RUNTIME.mkdir();m.durable_json(m.BASE/'automation.json',{'status':'ACTIVE'})
try:m.execute_transition('cutover',original,rehearsal=True,fail_after='shadow-disabled')
except RuntimeError:pass
changed=b'{"records":{},"lastLegacyRun":1}'
for p in [original,snap]:(p/rel).write_bytes(changed)
m.durable_json(snap/'snapshot-manifest.json',{'files':[{'relative':str(rel),'sha256':m.digest(changed)}]})
m.execute_transition('cutover',original,rehearsal=True);assert json.loads((m.ROOT/'live-authorization.json').read_text())['legacyStateSha256']==m.digest(changed)
m.execute_transition('rollback',original,rehearsal=True)
`;
  const r=spawnSync('/usr/local/bin/python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 }finally{await removeFixture(base);}
});
