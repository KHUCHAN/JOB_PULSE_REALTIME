import './desktop-guard.cjs';
// Disabled until transition.py receives a separate --go. Never invoked here.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile),code=path.dirname(fileURLToPath(import.meta.url)),base=path.join(os.homedir(),'Library/Application Support/Job Pulse'),runtime=path.join(base,'review-runtime'),root=path.join(base,'runtime-root');
const hold=path.join(root,'live-hold.json'),inflight=path.join(root,'live-inflight.json');
const exists=async p=>fs.access(p).then(()=>true,()=>false);
if(!await exists(path.join(root,'live-authorization.json')))throw Error('hold-live-not-authorized');
if(await exists(hold))throw Error('hold-live-uncertain-attempt; read-only reconciliation required');
if(await exists(inflight)&&JSON.parse(await fs.readFile(inflight)).status!=='completed')throw Error('hold-prior-live-inflight; never retry an uncertain POST');
await exec('/usr/local/bin/python3',[path.join(code,'transition.py'),'assert-paused'],{timeout:30000});
const label='live-'+new Date().toISOString().replaceAll(':','').replaceAll('.','-'),out=path.join(runtime,'live-runs',label);await fs.mkdir(out,{recursive:true});
let postsPossible=false;
try{
 // One dispatch-capable call. An uncertain result places the entire live lane
 // on durable hold; a later invocation cannot blindly dispatch again.
 await fs.writeFile(inflight,JSON.stringify({status:'attempting',at:new Date().toISOString(),out}),{mode:0o600});
 postsPossible=true;
 const crawl=await exec(process.execPath,[path.join(code,'../scripts/check-production-crawl.mjs'),'--dispatch'],{cwd:path.join(base,'repo'),timeout:180000,maxBuffer:16*1024*1024});
 await fs.writeFile(path.join(out,'crawl-check.json'),crawl.stdout,{flag:'wx'});
 await exec('/usr/local/bin/python3',[path.join(code,'snapshot-runtime.py'),'--live-source'],{timeout:60000});
 const quarantined=[];
 for(const dir of await fs.readdir(path.join(runtime,'live-runs'))){for(const file of await fs.readdir(path.join(runtime,'live-runs',dir)))if(file.startsWith('post-attempt-')){const r=JSON.parse(await fs.readFile(path.join(runtime,'live-runs',dir,file)));quarantined.push(...r.identities);}}
 const quarantine=path.join(out,'quarantine.json');await fs.writeFile(quarantine,JSON.stringify(quarantined));
 const shadow=await exec(process.execPath,[path.join(code,'review-run.mjs'),...(process.argv.includes('--exceptions')?['--exceptions']:[])],{env:{...process.env,JOB_PULSE_QUARANTINE:quarantine},timeout:1200000,maxBuffer:16*1024*1024});
 const report=JSON.parse(shadow.stdout);if(report.status!=='completed-shadow'||!report.recipientCheck)throw Error('Deterministic evaluation held');
 const scan=JSON.parse(await fs.readFile(path.join(report.out,report.stamp+'.json')));
 // These existing inputs require explicit integration evidence before the
 // writer transfer. Holding is preferable to silently dropping their leads.
 const readiness=JSON.parse(await fs.readFile(path.join(root,'coverage-readiness.json')));
 if(readiness.community!==true||readiness.inbox!==true||readiness.platforms!==true)throw Error('hold-secondary-coverage-not-verified');
 if(scan.inbox?.length&&readiness.inboxStamp!==report.stamp)throw Error('hold-unprocessed-inbox');
 const stamp=report.stamp,env={...process.env,JOB_PULSE_PROJECT_ROOT:root,JOB_PULSE_SHADOW_OUTPUT:report.out,JOB_PULSE_STAMP:stamp,JOB_PULSE_LIVE_TRANSPORT:'authorized'};
 const run=async(name,script,args,stage='gate')=>{const r=await exec(process.execPath,['--require',path.join(code,'desktop-guard.cjs'),'--require',path.join(runtime,'preload.cjs'),'--require',path.join(code,'shadow-guard.cjs'),script,...args],{env:{...env,JOB_PULSE_LIVE_STAGE:stage},timeout:900000,maxBuffer:16*1024*1024});await fs.writeFile(path.join(out,name+'.log'),r.stdout+r.stderr,{flag:'wx'});};
 const planPath=path.join(report.out,stamp+'-us-plan.json'),plan=JSON.parse(await fs.readFile(planPath));
 const undecidable=new Set(plan.audit.filter(a=>a.error||a.failed?.some(f=>!['fit','program'].includes(f))).map(a=>a.id));
 plan.reviews=plan.reviews.filter(r=>!undecidable.has(r.jobId));plan.pending=plan.pending.filter(p=>report.selectedIds.includes(p.jobId));
 await fs.writeFile(planPath,JSON.stringify(plan));const preparedPath=path.join(report.out,stamp+'-prepared.json'),prepared=JSON.parse(await fs.readFile(preparedPath));prepared.reviews=plan.reviews;await fs.writeFile(preparedPath,JSON.stringify(prepared));
 await fs.mkdir(path.join(runtime,'runs',stamp),{recursive:true});
 for(const n of ['final-gates','caveat-audit-prepersist'])await run(n,path.join(runtime,n+'.mjs'),[root,stamp]);
 await run('policy-preflight',path.join(runtime,'policy-preflight.mjs'),[root,runtime,stamp]);
 if(plan.reviews.length)await run('persist',path.join(runtime,'persist-verified.mjs'),[root,stamp],'persist');
 else await fs.writeFile(path.join(report.out,stamp+'-us-accepted.json'),JSON.stringify({accepted:[]}));
 // Legacy dispatch rechecks exact fresh job and official evidence, records
 // alerts.sent=1, then verifies each durable delivered ID before state writes.
 await run('dispatch',path.join(runtime,'dispatch-verified.mjs'),[root,stamp],'dispatch');
 await fs.mkdir(path.join(root,'review-runtime'),{recursive:true});await fs.copyFile(path.join(report.out,'undated-source-observations.json'),path.join(root,'review-runtime/undated-source-observations.json'));
 await fs.writeFile(path.join(out,'completed.json'),JSON.stringify({stamp,at:new Date().toISOString(),reviewEvidence:report.out}));
 await fs.writeFile(inflight,JSON.stringify({status:'completed',stamp,out,at:new Date().toISOString()}),{mode:0o600});
 console.log(JSON.stringify({status:'completed-live',stamp,out}));
}catch(error){
 if(postsPossible)await fs.writeFile(hold,JSON.stringify({at:new Date().toISOString(),reason:error.message,out,neverRetryUncertainPost:true}),{flag:'wx'});
 console.error(JSON.stringify({status:'hold-live',reason:error.message,out}));process.exitCode=1;
}
