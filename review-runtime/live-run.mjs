import './evidence-io.cjs';
import './desktop-guard.cjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),config=require('./live-config.cjs'),{atomic}=require('./atomic-state.cjs'),{assertPaused}=require('./assert-paused.cjs');
import {assertDisk,compressEvidence} from './disk-evidence.mjs';
import {attempts,reconcile} from './reconcile.mjs';
import {recordRun} from './run-status.mjs';
import {acquireReviewLock} from './lane-lock.mjs';
await acquireReviewLock().catch(async e=>{await recordRun({status:'hold-owner-lock'});throw e;});
// Disabled until transition.py receives a separate --go. Never invoked here.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile),code=path.dirname(fileURLToPath(import.meta.url)),base=config.base,runtime=path.join(base,'review-runtime'),root=path.join(base,'runtime-root');
const hold=path.join(root,'live-hold.json'),inflight=path.join(root,'live-inflight.json');
const exists=async p=>fs.access(p).then(()=>true,()=>false);
try{
await assertDisk(runtime);
if(!await exists(path.join(root,'live-authorization.json')))throw Error('hold-live-not-authorized');
if(await exists(path.join(root,'rollback-completed.json')))throw Error('hold-live-rolled-back');
if(await exists(hold)&&!JSON.parse(await fs.readFile(hold)).resolved)throw Error('hold-live-uncertain-attempt; read-only reconciliation required');
if(await exists(inflight)&&JSON.parse(await fs.readFile(inflight)).status!=='completed')throw Error('hold-prior-live-inflight; never retry an uncertain POST');
if((await attempts(runtime)).some(a=>a.status!=='completed'))throw Error('hold-unresolved-attempt');
await assertPaused();
const label='live-'+new Date().toISOString().replaceAll(':','').replaceAll('.','-'),out=path.join(runtime,'live-runs',label);await fs.mkdir(out,{recursive:true});
let postsPossible=false;
try{
 // One dispatch-capable call. An uncertain result places the entire live lane
 // on durable hold; a later invocation cannot blindly dispatch again.

 let report;
 if(config.rehearsal){
  const input=JSON.parse(await fs.readFile(path.join(base,'rehearsal-input.json'))),stamp='heartbeat-'+new Date().toISOString().replace(/[-:]/g,'').slice(0,15);
  const state=JSON.parse(await fs.readFile(path.join(root,'.codex_tmp/codex-direct-db-gmail-state.json'))),records=Object.values(state.records);
  const rows=input.rows.filter(j=>!records.some(r=>r.jobId===j.id&&(r.sentAt||r.identityAlreadyNotified)));
  const scan={runAt:new Date().toISOString(),scans:{'United States':{stop:'end'}},details:rows.filter(j=>!records.some(r=>r.jobId===j.id&&r.decision==='approve')).map(row=>({row})),mail:input.mail};
  const {guardScan}=await import('./source-guard.mjs');await guardScan(scan,input.sources,out);
  if(scan.datePolicyGuard.decisions.some(d=>d.action==='hold'))throw Error('hold-source-guard: '+JSON.stringify(scan.datePolicyGuard.decisions));
  const reviews=input.reviews.filter(r=>rows.some(j=>j.id===r.jobId)&&!records.some(x=>x.jobId===r.jobId));
  const pending=rows.filter(j=>records.some(r=>r.jobId===j.id&&r.decision==='approve')).map(j=>({...input.reviews.find(r=>r.jobId===j.id),...input.audit.find(a=>a.id===j.id)}));
  const plan={reviews,pending,pendingExcluded:[],audit:input.audit};
  for(const [suffix,value] of Object.entries({'':scan,'-us-plan':plan,'-prepared':{reviews},'-official':input.official,'-pending':{details:rows.filter(j=>records.some(r=>r.jobId===j.id&&r.decision==='approve')).map(row=>({row}))},'-pending-official':input.official.filter(e=>pending.some(p=>p.jobId===e.id))}))await fs.writeFile(path.join(out,stamp+suffix+'.json'),JSON.stringify(value));
  // Exercise the shared log name that review-run creates before live gates.
  await fs.writeFile(path.join(out,'policy-gates.log'),'shadow gate completed',{flag:'wx'});
  report={status:'completed-shadow',recipientCheck:true,selectedIds:rows.map(j=>j.id),stamp,out};
 }else{
 const crawl=await exec(process.execPath,[path.join(code,'../scripts/check-production-crawl.mjs'),'--dispatch'],{cwd:path.join(base,'repo'),timeout:180000,maxBuffer:16*1024*1024});
 await fs.writeFile(path.join(out,'crawl-check.json'),crawl.stdout,{flag:'wx'});
 await exec('/usr/local/bin/python3',[path.join(code,'snapshot-runtime.py'),'--live-source'],{timeout:60000});
 const quarantined=[];
 for(const dir of await fs.readdir(path.join(runtime,'live-runs'))){for(const file of await fs.readdir(path.join(runtime,'live-runs',dir)))if(file.startsWith('post-attempt-')){const r=JSON.parse(await fs.readFile(path.join(runtime,'live-runs',dir,file)));if(r.status!=='completed')quarantined.push(...r.identities);}}
 const quarantine=path.join(out,'quarantine.json');await fs.writeFile(quarantine,JSON.stringify(quarantined));
 const shadow=await exec(process.execPath,[path.join(code,'review-run.mjs'),...(process.argv.includes('--exceptions')?['--exceptions']:[])],{env:{...process.env,JOB_PULSE_QUARANTINE:quarantine,JOB_PULSE_CRAWL_RESULT:crawl.stdout,JOB_PULSE_LANE:'live',JOB_PULSE_EVIDENCE_OUTPUT:out},timeout:1200000,maxBuffer:16*1024*1024});
 report=JSON.parse(shadow.stdout.trim().split('\n').at(-1));if(report.status!=='completed-shadow'||!report.recipientCheck)throw Error('Deterministic evaluation held');
 const scan=JSON.parse(await fs.readFile(path.join(report.out,report.stamp+'.json')));
 if(scan.datePolicyGuard?.decisions?.some(d=>d.action==='hold'))throw Error('hold-source-guard: '+JSON.stringify(scan.datePolicyGuard.decisions));
 }
 // These existing inputs require explicit integration evidence before the
 // writer transfer. Holding is preferable to silently dropping their leads.
 const {coverageReadiness}=await import('./coverage-check.mjs');
 const readiness=config.rehearsal?{blockers:[]}:await coverageReadiness(report);if(readiness.blockers.length)throw Error('hold-secondary-coverage: '+readiness.blockers.join(', '));
 const stamp=report.stamp,env={...process.env,JOB_PULSE_PROJECT_ROOT:root,JOB_PULSE_SHADOW_OUTPUT:report.out,JOB_PULSE_STAMP:stamp,JOB_PULSE_LIVE_TRANSPORT:'authorized'};
 const run=async(name,script,args,stage='gate')=>{const r=await exec(process.execPath,['--require',path.join(code,'desktop-guard.cjs'),'--require',path.join(runtime,'preload.cjs'),'--require',path.join(code,'shadow-guard.cjs'),script,...args],{env:{...env,JOB_PULSE_LIVE_STAGE:stage},...(stage==='gate'?{timeout:900000}:{}),maxBuffer:16*1024*1024});await fs.writeFile(path.join(out,name+'.log'),r.stdout+r.stderr,{flag:'wx'});};
 const planPath=path.join(report.out,stamp+'-us-plan.json'),plan=JSON.parse(await fs.readFile(planPath));
 plan.pending=plan.pending.filter(p=>report.selectedIds.includes(p.jobId));
 await fs.writeFile(planPath,JSON.stringify(plan));const preparedPath=path.join(report.out,stamp+'-prepared.json'),prepared=JSON.parse(await fs.readFile(preparedPath));prepared.reviews=plan.reviews;await fs.writeFile(preparedPath,JSON.stringify(prepared));
 await fs.mkdir(path.join(runtime,'runs',stamp),{recursive:true});
 await run('live-policy-gates',path.join(code,'policy-gates.mjs'),[root,stamp]);
 await run('policy-preflight',path.join(runtime,'policy-preflight.mjs'),[root,runtime,stamp]);
 await assertDisk(root);
 await assertPaused();
 atomic(inflight,JSON.stringify({status:'attempting',at:new Date().toISOString(),out}));
 postsPossible=true;
 if(plan.reviews.length)await run('persist',path.join(runtime,'persist-verified.mjs'),[root,stamp],'persist');
 else await fs.writeFile(path.join(report.out,stamp+'-us-accepted.json'),JSON.stringify({accepted:[]}));
 // Legacy dispatch rechecks exact fresh job and official evidence, records
 // alerts.sent=1, then verifies each durable delivered ID before state writes.
 await assertPaused();
 await run('dispatch',path.join(code,'live-dispatch.mjs'),[root,stamp],'dispatch');
 await fs.mkdir(path.join(root,'review-runtime'),{recursive:true});for(const name of ['undated-source-observations.json','community-lookup-checkpoints.json'])if(await exists(path.join(report.out,name)))atomic(path.join(root,'review-runtime',name),await fs.readFile(path.join(report.out,name)));
 // Retain every scan page, official body, gate input/output and attempt receipt beside the summary.
 if(report.out!==out)for(const name of await fs.readdir(report.out))await fs.copyFile(path.join(report.out,name),path.join(out,name));
 const accepted=JSON.parse(await fs.readFile(path.join(out,stamp+'-us-accepted.json')));
 const dispatch=JSON.parse(await fs.readFile(path.join(out,stamp+'-us-dispatch-plan.json')));
 let outcome;try{outcome=JSON.parse(await fs.readFile(path.join(out,stamp+'-us-outcome.json')));}catch(error){
  if(error.code!=='ENOENT'||dispatch.selected.length||await exists(path.join(out,'mail-attempt-once.json')))throw error;
  // The archived no-selection path exits before writing a mail outcome.
  outcome={sent:0,confirmed:0,jobIds:[],recipients:dispatch.recipients};
 }
 const summary={...report,status:'complete',reviewCompletionEstablished:true,finishedAt:new Date().toISOString(),requestedReviews:plan.reviews.length,acceptedReviews:accepted.accepted.length,newApprovals:plan.reviews.filter(r=>r.decision==='approve').length,rejections:plan.reviews.filter(r=>r.decision==='reject').length,selectedIds:dispatch.selected,emailsSent:outcome.sent,gmailVerification:{alertsSent:outcome.sent,durableDeliveryVerified:outcome.confirmed===dispatch.selected.length,recipients:outcome.recipients,durableDeliveredIds:outcome.jobIds},delivery:outcome.jobIds,reviewEvidence:out,posts:'see post-attempt receipts'};
 const resolution=await reconcile({root,runtime});if(resolution.unresolved)throw Error('hold-unresolved-server-durability');
 await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));
 atomic(inflight,JSON.stringify({status:'completed',stamp,out,at:new Date().toISOString()}));
 await recordRun({status:'complete',out});
 console.log(JSON.stringify({status:'completed-live',stamp,out}));
}catch(error){
 if(postsPossible)atomic(hold,JSON.stringify({at:new Date().toISOString(),reason:error.message,out,neverRetryUncertainPost:true}));
 await fs.writeFile(path.join(out,'summary.json'),JSON.stringify({status:'hold-live',reviewCompletionEstablished:false,reason:error.message,out,finishedAt:new Date().toISOString(),postsPossible},null,2));
 await recordRun({status:'hold-live',out});
 console.error(JSON.stringify({status:'hold-live',reason:error.message,out}));process.exitCode=1;
}finally{
 await compressEvidence(out);
}

}catch(error){await recordRun({status:'hold-startup',reason:error.message});console.error(JSON.stringify({status:'hold-startup',reason:error.message}));process.exitCode=1;}
