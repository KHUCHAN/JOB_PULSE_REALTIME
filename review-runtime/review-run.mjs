import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pendingEffectiveDate } from './date-policy.mjs';
const codeDir=path.dirname(fileURLToPath(import.meta.url));
const runtime=process.env.JOB_PULSE_RUNTIME??path.resolve(codeDir,'../../review-runtime');
const project=process.env.JOB_PULSE_CANONICAL_PROJECT??JSON.parse(await fs.readFile(path.join(runtime,'config.local.json'))).canonicalProject;
const args=process.argv.slice(2),replayIndex=args.indexOf('--replay'),replay=replayIndex>=0?path.resolve(args[replayIndex+1]):null;
if(args.some(x=>['--write','--dispatch','--persist'].includes(x)))throw Error('Phase 3 not authorized; runner is shadow-only');
if(!project)throw Error('JOB_PULSE_CANONICAL_PROJECT required; canonical state is never relocated');
let runAt=new Date().toISOString(),stamp='heartbeat-'+runAt.replace(/[-:]/g,'').slice(0,15);
if(replay){const summary=JSON.parse(await fs.readFile(path.join(replay,'summary.json')));runAt=summary.runAt;stamp=summary.stamp;}
const label=(replay?'replay-':'shadow-')+stamp+'-'+Date.now();
const out=path.join(runtime,'shadow-runs',label);await fs.mkdir(out,{recursive:true});
try{await fs.copyFile(path.join(runtime,'undated-source-observations.json'),path.join(out,'undated-source-observations.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
const stateAccessMarker=path.join(runtime,'shadow-state-access-hold.json');
try{const marker=JSON.parse(await fs.readFile(stateAccessMarker));if(marker.status==='hold'&&!args.includes('--retry-state-access')){console.log(JSON.stringify({status:'hold-state-access',reason:'Known background access blocker; explicit supervised retry required',posts:0,llmTokens:0}));process.exit(1);}}catch(error){if(error.code!=='ENOENT')throw error;}
const statePath=path.join(project,'.codex_tmp/codex-direct-db-gmail-state.json');
const boundedStateRead=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Canonical state read did not finish within 30 seconds')),30000);fs.readFile(statePath).then(resolve,reject).finally(()=>clearTimeout(timer));});
let stateBefore;try{stateBefore=await boundedStateRead();}catch(error){const report={kind:replay?'offline-gate-replay':'live-shadow',stamp,runAt,out,status:'hold-state-access',error:error.message,posts:0,llmTokens:0};await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2));await fs.writeFile(stateAccessMarker,JSON.stringify({status:'hold',at:new Date().toISOString(),reason:error.message},null,2));console.log(JSON.stringify(report));process.exit(1);}
const stateHash=createHash('sha256').update(stateBefore).digest('hex');
const heldIds=['0372c3b6-f552-4eda-b4cc-4e7d1e807664','035b9146-f749-4e3f-8d85-2c753e4287ab','6507b05a-279b-4bba-9bb7-14e60bc9db9f','90f82229-368f-49cc-8f9a-5f48b3ce0f6c','eaf48f95-7b8b-4e63-aaf9-b2f27453c13e'];
const env={...process.env,JOB_PULSE_PROJECT_ROOT:project,JOB_PULSE_SHADOW_OUTPUT:out};
const stages=[];let result={kind:replay?'offline-gate-replay':'live-shadow',stamp,runAt,out,posts:0,llmTokens:0,selectedIds:[],held:[],stages};
const read=async suffix=>JSON.parse(await fs.readFile(path.join(out,stamp+suffix+'.json'),'utf8'));
async function run(name,script,extra=[]){
 const start=Date.now();const log=await fs.open(path.join(out,name+'.log'),'wx');
 try{await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--require',path.join(runtime,'preload.cjs'),'--require',path.join(codeDir,'shadow-guard.cjs'),script,...extra],{env,cwd:project,stdio:['ignore',log.fd,log.fd]});const timer=setTimeout(()=>child.kill('SIGTERM'),15*60*1000);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error(`${name} exit ${code}`));});});stages.push({name,status:'passed',ms:Date.now()-start});}finally{await log.close();}
}
const stage=(name,...extra)=>run(name,path.join(runtime,'review-stage.mjs'),[project,stamp,runAt,...extra]);
try{
 if(replay){
   for(const suffix of ['', '-official','-pending-official','-pending','-secondary']){try{await fs.copyFile(path.join(replay,stamp+suffix+'.json'),path.join(out,stamp+suffix+'.json'));}catch(e){if(e.code!=='ENOENT')throw e;}}
   const scan=await read('');const candidates=scan.details.map(x=>x.row.id);await fs.writeFile(path.join(out,'replay-candidates.json'),JSON.stringify(candidates));
   env.JOB_PULSE_REPLAY_CANDIDATES=path.join(out,'replay-candidates.json');env.JOB_PULSE_REPLAY_ASOF=runAt;
   // The replay uses saved official bodies; it does not claim a frozen pre-run
   // history snapshot, which was not retained. No durable state file is created.
   result.identityReplay='current history projected before runAt; not a frozen historical state';
 }else{
   const guard=spawn(process.execPath,[path.resolve(codeDir,'../scripts/check-production-crawl.mjs')],{cwd:path.resolve(codeDir,'..'),stdio:['ignore','pipe','pipe']});let text='';for await(const chunk of guard.stdout)text+=chunk;await new Promise(resolve=>guard.on('close',resolve));result.crawlGuard=JSON.parse(text);
   await run('scan',path.join(project,'.codex_tmp/heartbeat-20260910T073856-scan.mjs'),[stamp.replace('heartbeat-',''),runAt]);
   await stage('seed','seed');
   // Pending reconciliation is read-only; never call the legacy state updater.
   const state=JSON.parse(stateBefore),pending={details:[],excluded:[]};
   for(const r of Object.values(state.records).filter(r=>r.decision==='approve'&&!r.sentAt&&!r.identityAlreadyNotified)){
     if(heldIds.includes(r.jobId)){pending.excluded.push({jobId:r.jobId,reason:'immutable user hold'});continue;}
     let date=pendingEffectiveDate(r),row;
     if(!date&&r.rationale?.includes('게시일 미표기 · 수집일 ')){const response=await fetch('https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse?resource=job&id='+encodeURIComponent(r.jobId));if(!response.ok)throw Error('Pending fallback GET failed');row=await response.json();date=pendingEffectiveDate(r,row);}
     if(!date||Date.parse(date)<Date.parse(runAt)-72*3600000){pending.excluded.push({jobId:r.jobId,reason:'old/unverified pending date'});continue;}
     if(!row){const response=await fetch('https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse?resource=job&id='+encodeURIComponent(r.jobId));if(!response.ok)throw Error('Pending GET failed');row=await response.json();}
     if(!row.resumeNotifiedAt&&!row.resumeIdentityAlreadyNotified)pending.details.push({row});
   }
   await fs.writeFile(path.join(out,stamp+'-pending.json'),JSON.stringify(pending));
   await stage('official-fast','official-fast');await stage('enrich','enrich');await stage('vendor-details','vendor-details');await stage('microsoft-epochs','microsoft-epochs');
   for(const n of ['lockheed-epochs','greenhouse-us-proof'])await run(n,path.join(runtime,n+'.mjs'),[project,stamp]);
 }
 // Reuse verified keyword preparation, source cleaning, final gates and caveat
 // audit. The two POST helpers are deliberately absent from this program.
 await run('prepare',path.join(codeDir,'prepare-shadow.mjs'),[project,runtime,stamp]);
 const prep=await read('-prepared');
 if(replay){const saved=JSON.parse(await fs.readFile(path.join(replay,stamp+'-us-plan.json')));await fs.writeFile(path.join(out,stamp+'-us-plan.json'),JSON.stringify({...saved,reviews:prep.reviews,audit:prep.audit,pending:[]}));}
 else await stage('plan','run','transport','plan');
 await stage('precision','final-precision-2');await stage('source-precision','source-precision');
 for(const n of ['source-clean-prepersist','final-gates','caveat-audit-prepersist'])await run(n,path.join(runtime,n+'.mjs'),[project,stamp]);
 await run('complete-caveats',path.join(codeDir,'complete-caveats.mjs'),[project,stamp]);
 await run('post-caveat-gates',path.join(runtime,'final-gates.mjs'),[project,stamp,'post-caveats']);
 const plan=await read('-us-plan');
 const caveatText=await fs.readFile(path.join(out,'caveat-audit-prepersist.log'),'utf8');const caveatMissing=JSON.parse(caveatText.slice(0,caveatText.lastIndexOf(']')+1));
 const caveatHolds=JSON.parse(await fs.readFile(path.join(out,'caveat-holds.json')));const caveatIds=new Set(caveatHolds.map(x=>x.id));result.caveatHolds=caveatHolds;
 result.selectedIds=plan.reviews.filter(r=>r.decision==='approve'&&!heldIds.includes(r.jobId)&&!caveatIds.has(r.jobId)).map(r=>r.jobId).concat(plan.pending.filter(r=>!heldIds.includes(r.jobId)).map(r=>r.jobId));
 const scan=await read('');const expectedRecipients=['kimchany@usc.edu','lupeter@usc.edu','xinjiaz@usc.edu','skazimi@usc.edu'];result.recipientCheck=expectedRecipients.every(x=>scan.mail?.recipients?.includes(x));
 if(result.selectedIds.length>500)throw Error('Combined selection exceeds 500 IDs');
 for(const review of plan.reviews.filter(r=>result.selectedIds.includes(r.jobId))){const audit=plan.audit.find(a=>a.id===review.jobId);if(!audit||audit.country!=='United States'||audit.failed?.length||!Number.isFinite(Date.parse(audit.date))||Date.parse(audit.date)<Date.parse(runAt)-72*3600000||Date.parse(audit.date)>Date.parse(runAt)||!review.rationale.startsWith('Keyword match (not individually reviewed)')||review.rationale.length>2000)throw Error('Final policy check failed: '+review.jobId);}
 result.reviewIds=plan.reviews.map(r=>({id:r.jobId,decision:r.decision}));
 result.held=plan.audit.filter(a=>a.error||a.failed?.length).map(a=>({id:a.id,reason:a.error??a.failed}));
 if(replay){const baseline=JSON.parse(await fs.readFile(path.join(replay,'summary.json'))),old=new Set(baseline.selectedIds??[]),fresh=new Set(result.selectedIds);result.comparison={original:[...old],added:[...fresh].filter(id=>!old.has(id)),removed:[...old].filter(id=>!fresh.has(id))}; const previous=JSON.parse(await fs.readFile(path.join(replay,stamp+'-prepared.json')));result.comparison.differences=[...result.comparison.added,...result.comparison.removed].map(id=>({id,old:previous.audit.find(x=>x.id===id),replayed:plan.audit.find(x=>x.id===id),caveatHold:result.caveatHolds.find(x=>x.id===id)}));}
 if(args.includes('--exceptions')){const {exceptionForRow}=await import('./exception-run.mjs');const scan=await read(''),official=await read('-official'),context={calls:0,output:out};result.exceptions=[];for(const issue of plan.audit.filter(a=>a.error)){const row=scan.details.find(x=>x.row.id===issue.id)?.row;if(!row)continue;const evidence=official.find(x=>x.id===row.id);result.exceptions.push(await exceptionForRow(row,evidence?.text??'',issue.error,context));}result.llmTokens=result.exceptions.reduce((n,x)=>n+(x.usage?.input_tokens??0),0);}
 result.status='completed-shadow';
}catch(error){result.status='hold-pipeline-error';result.error=error.message;}
const after=await boundedStateRead();result.canonicalStateUnchanged=createHash('sha256').update(after).digest('hex')===stateHash;
if(!result.canonicalStateUnchanged)result.stateObservation='state changed externally during run; shadow state writes are prohibited by guard';
result.finishedAt=new Date().toISOString();await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
if(result.status!=='completed-shadow')process.exitCode=1;
