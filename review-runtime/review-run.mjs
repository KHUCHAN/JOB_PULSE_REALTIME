import './desktop-guard.cjs';
import {acquireReviewLock} from './lane-lock.mjs';
await acquireReviewLock();
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pendingEffectiveDate } from './date-policy.mjs';
const codeDir=path.dirname(fileURLToPath(import.meta.url));
const runtime=process.env.JOB_PULSE_RUNTIME??path.resolve(codeDir,'../../review-runtime');
const snapshotLink=path.resolve(runtime,'../runtime-root/current-snapshot');
let project;try{project=await fs.realpath(snapshotLink);const manifest=JSON.parse(await fs.readFile(path.join(project,'snapshot-manifest.json')));for(const entry of manifest.files){const bytes=await fs.readFile(path.join(project,entry.relative));if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Snapshot hash mismatch: '+entry.relative);}}catch(error){console.log(JSON.stringify({status:'hold-snapshot-missing-or-invalid',error:error.message,posts:0,llmTokens:0}));process.exit(1);}
if(process.env.JOB_PULSE_LANE!=='live'){try{await fs.access(path.resolve(runtime,'../runtime-root/live-authorization.json'));try{await fs.access(path.resolve(runtime,'../runtime-root/rollback-completed.json'));}catch{throw Error('hold-shadow-live-authorized');}}catch(e){if(e.code!=='ENOENT')throw e;}}
const args=process.argv.slice(2),replayIndex=args.indexOf('--replay'),replay=replayIndex>=0?path.resolve(args[replayIndex+1]):null;
if(args.some(x=>['--write','--dispatch','--persist'].includes(x)))throw Error('Phase 3 not authorized; runner is shadow-only');
if(project.startsWith(path.join(process.env.HOME,'Desktop')+path.sep))throw Error('Desktop project forbidden');
let runAt=new Date().toISOString(),stamp='heartbeat-'+runAt.replace(/[-:]/g,'').slice(0,15);
if(replay){const summary=JSON.parse(await fs.readFile(path.join(replay,'summary.json')));runAt=summary.runAt;stamp=summary.stamp;}
const label=(replay?'replay-':'shadow-')+stamp+'-'+Date.now();
const out=process.env.JOB_PULSE_LANE==='live'&&process.env.JOB_PULSE_EVIDENCE_OUTPUT?path.resolve(process.env.JOB_PULSE_EVIDENCE_OUTPUT):path.join(runtime,'shadow-runs',label);await fs.mkdir(out,{recursive:true});
try{await fs.copyFile(path.join(project,'review-runtime/undated-source-observations.json'),path.join(out,'undated-source-observations.json'));await fs.chmod(path.join(out,'undated-source-observations.json'),0o600);}catch(error){if(error.code!=='ENOENT')throw error;}
for(const name of ['community-lookup-checkpoints.json'])try{await fs.copyFile(path.join(project,'review-runtime',name),path.join(out,name));await fs.chmod(path.join(out,name),0o600);}catch(e){if(e.code!=='ENOENT')throw e;}
const statePath=path.join(project,'.codex_tmp/codex-direct-db-gmail-state.json');
const boundedStateRead=()=>fs.readFile(statePath);
const stateBefore=await boundedStateRead();
const stateHash=createHash('sha256').update(stateBefore).digest('hex');
const heldIds=['0372c3b6-f552-4eda-b4cc-4e7d1e807664','035b9146-f749-4e3f-8d85-2c753e4287ab','6507b05a-279b-4bba-9bb7-14e60bc9db9f','90f82229-368f-49cc-8f9a-5f48b3ce0f6c','eaf48f95-7b8b-4e63-aaf9-b2f27453c13e'];
const env={...process.env,JOB_PULSE_PROJECT_ROOT:project,JOB_PULSE_SHADOW_OUTPUT:out};
let quarantine=[];if(process.env.JOB_PULSE_QUARANTINE)quarantine=JSON.parse(await fs.readFile(process.env.JOB_PULSE_QUARANTINE));
const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const canon=s=>{try{const u=new URL(s);u.hash='';for(const k of [...u.searchParams.keys()])if(/^(utm_|source$|src$|ref$|gh_src$|_ccid$)/i.test(k))u.searchParams.delete(k);return u.href.replace(/\/$/,'');}catch{return null;}};
const uncertain=j=>quarantine.some(q=>q.id===j.id||(q.officialUrl&&canon(q.officialUrl)===canon(j.officialUrl))||(q.requisitionId&&norm(q.company)===norm(j.company)&&norm(q.requisitionId)===norm(j.requisitionId))||(q.company&&[q.company,q.title,q.location].map(norm).join('|')===[j.company,j.title,j.location].map(norm).join('|')));
const codeEvidence=Object.fromEntries(await Promise.all(['review-run.mjs','community-discovery.mjs','community-merge.mjs','inbox-stage.mjs','shadow-guard.cjs','source-guard.mjs','date-policy.mjs','prepare-shadow.mjs','evidence-policy.mjs','caveats.mjs','policy-gates.mjs','comparison-policy.mjs','keyword-policy.mjs','dispatch-policy.mjs','live-dispatch.mjs','live-run.mjs','run-status.mjs','watchdog.mjs','launchd-audit.mjs','../scripts/check-production-crawl.mjs','../lib/resume-match.ts'].map(async n=>[n,createHash('sha256').update(await fs.readFile(path.join(codeDir,n))).digest('hex')])));
const stages=[];let result={kind:replay?'offline-gate-replay':'live-shadow',stamp,runAt,out,posts:0,llmTokens:0,selectedIds:[],held:[],stages};
const read=async suffix=>JSON.parse(await fs.readFile(path.join(out,stamp+suffix+'.json'),'utf8'));
async function run(name,script,extra=[]){
 const start=Date.now();const log=await fs.open(path.join(out,name+'.log'),'wx');
 try{await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--require',path.join(codeDir,'desktop-guard.cjs'),'--require',path.join(runtime,'preload.cjs'),'--require',path.join(codeDir,'shadow-guard.cjs'),script,...extra],{env,cwd:project,stdio:['ignore',log.fd,log.fd]});const timer=setTimeout(()=>child.kill('SIGTERM'),15*60*1000);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error(`${name} exit ${code}`));});});stages.push({name,status:'passed',ms:Date.now()-start});}finally{await log.close();}
}
const stage=(name,...extra)=>run(name,path.join(runtime,'review-stage.mjs'),[project,stamp,runAt,...extra]);
try{
 if(replay){
   try{await fs.copyFile(path.join(replay,'source-health-after-delivery.json'),path.join(out,'source-health.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
   for(const suffix of ['', '-official','-pending-official','-pending','-secondary']){try{await fs.copyFile(path.join(replay,stamp+suffix+'.json'),path.join(out,stamp+suffix+'.json'));await fs.chmod(path.join(out,stamp+suffix+'.json'),0o600);}catch(e){if(e.code!=='ENOENT')throw e;}}
   const scan=await read('');const candidates=scan.details.map(x=>x.row.id);await fs.writeFile(path.join(out,'replay-candidates.json'),JSON.stringify(candidates));
   env.JOB_PULSE_REPLAY_CANDIDATES=path.join(out,'replay-candidates.json');env.JOB_PULSE_REPLAY_ASOF=runAt;
   // The replay uses saved official bodies; it does not claim a frozen pre-run
   // history snapshot, which was not retained. No durable state file is created.
   result.identityReplay='current history projected before runAt; not a frozen historical state';
   try{await fs.copyFile(path.join(replay,'community-discovery.json'),path.join(out,'community-discovery.json'));await fs.chmod(path.join(out,'community-discovery.json'),0o600);await run('community-replay-merge',path.join(codeDir,'community-merge.mjs'),[project,runtime,stamp]);result.communityReplay=JSON.parse(await fs.readFile(path.join(out,'community-merge.json')));}catch(e){if(e.code!=='ENOENT')throw e;}
 }else{
   const {execFile}=await import('node:child_process');
   const {promisify}=await import('node:util');
   const guard=process.env.JOB_PULSE_CRAWL_RESULT?{stdout:process.env.JOB_PULSE_CRAWL_RESULT}:await promisify(execFile)(process.execPath,[path.resolve(codeDir,'../scripts/check-production-crawl.mjs')],{cwd:path.resolve(codeDir,'..'),timeout:180000,maxBuffer:16*1024*1024});result.crawlGuard=JSON.parse(guard.stdout);
   await run('scan',path.join(project,'.codex_tmp/heartbeat-20260910T073856-scan.mjs'),[stamp.replace('heartbeat-',''),runAt]);
   const freshScan=await read('');const excluded=freshScan.details.filter(x=>uncertain(x.row));
   result.held.push(...excluded.map(x=>({id:x.row.id,reason:'Prior transport attempt excluded; read-only reconciliation required'})));
   freshScan.details=freshScan.details.filter(x=>!uncertain(x.row));await fs.writeFile(path.join(out,stamp+'.json'),JSON.stringify(freshScan));
   await stage('seed','seed');
   // Pending reconciliation is read-only; never call the legacy state updater.
   const state=JSON.parse(stateBefore),pending={details:[],excluded:[]};
   for(const r of Object.values(state.records).filter(r=>r.decision==='approve'&&!r.sentAt&&!r.identityAlreadyNotified)){
     if(heldIds.includes(r.jobId)){pending.excluded.push({jobId:r.jobId,reason:'immutable user hold'});continue;}
     let date=pendingEffectiveDate(r),row;
     if(!date&&r.rationale?.includes('게시일 미표기 · 수집일 ')){const response=await fetch('https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse?resource=job&id='+encodeURIComponent(r.jobId));if(!response.ok)throw Error('Pending fallback GET failed');row=await response.json();date=pendingEffectiveDate(r,row);}
     if(!date||Date.parse(date)<Date.parse(runAt)-72*3600000){pending.excluded.push({jobId:r.jobId,reason:'old/unverified pending date'});continue;}
     if(!row){const response=await fetch('https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse?resource=job&id='+encodeURIComponent(r.jobId));if(!response.ok)throw Error('Pending GET failed');row=await response.json();}
     if(uncertain(row)){pending.excluded.push({jobId:r.jobId,reason:'prior uncertain attempt'});continue;}
     if(!row.resumeNotifiedAt&&!row.resumeIdentityAlreadyNotified)pending.details.push({row});
   }
   await fs.writeFile(path.join(out,stamp+'-pending.json'),JSON.stringify(pending));
   await run('community-discovery',path.join(codeDir,'community-discovery.mjs'),[project,runtime,stamp,runAt]);
   await run('community-merge',path.join(codeDir,'community-merge.mjs'),[project,runtime,stamp]);
   await run('inbox',path.join(codeDir,'inbox-stage.mjs'),[project,stamp]);
   const inbox=JSON.parse(await fs.readFile(path.join(out,'inbox-stage.json')));result.inbox=inbox;result.held.push(...inbox.held);
   const combined=await read(''),sourcesResponse=await fetch('https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse?resource=sources');if(!sourcesResponse.ok)throw Error('Combined source guard GET failed');
   const sources=await sourcesResponse.json();await fs.writeFile(path.join(out,'source-health.json'),JSON.stringify(sources));
   const {guardScan}=await import('./source-guard.mjs');await guardScan(combined,sources,out);
   result.held.push(...combined.details.filter(x=>uncertain(x.row)).map(x=>({id:x.row.id,reason:'Prior uncertain transport identity in secondary stage'})));combined.details=combined.details.filter(x=>!uncertain(x.row));
   await fs.writeFile(path.join(out,stamp+'.json'),JSON.stringify(combined));stages.push({name:'combined-source-guard',status:'passed'});
   await stage('official-fast','official-fast');await stage('enrich','enrich');await stage('vendor-details','vendor-details');
   try{await stage('microsoft-epochs','microsoft-epochs');}catch(error){
     const scan=await read(''),held=scan.details.filter(x=>x.row.company==='Microsoft');
     result.held.push(...held.map(x=>({id:x.row.id,reason:'Official Microsoft timestamp verification unavailable; held without a review decision'})));
     await fs.writeFile(path.join(out,'microsoft-epoch-holds.json'),JSON.stringify({error:error.message,rows:held}));
     scan.details=scan.details.filter(x=>x.row.company!=='Microsoft');await fs.writeFile(path.join(out,stamp+'.json'),JSON.stringify(scan));
   }
   for(const n of ['lockheed-epochs','greenhouse-us-proof'])await run(n,path.join(runtime,n+'.mjs'),[project,stamp]);
 }
 // Reuse verified keyword preparation, source cleaning, final gates and caveat
 // audit. The two POST helpers are deliberately absent from this program.
 await run('prepare',path.join(codeDir,'prepare-shadow.mjs'),[project,runtime,stamp]);
 const prep=await read('-prepared');
 if(replay){const saved=JSON.parse(await fs.readFile(path.join(replay,stamp+'-us-plan.json')));await fs.writeFile(path.join(out,stamp+'-us-plan.json'),JSON.stringify({...saved,reviews:prep.reviews,audit:prep.audit,pending:[]}));}
 else await stage('plan','run','transport','plan');
 // The prepared policy result is authoritative; archived per-company precision
 // and rejection branches cannot amend it. Keep the legacy plan's pending scope.
 const deterministicPlan=await read('-us-plan');deterministicPlan.reviews=prep.reviews;deterministicPlan.audit=prep.audit;
 await fs.writeFile(path.join(out,stamp+'-us-plan.json'),JSON.stringify(deterministicPlan));
 await run('policy-gates',path.join(codeDir,'policy-gates.mjs'),[project,stamp]);
 const plan=await read('-us-plan');
 const caveatIds=new Set();result.caveatHolds=[];
 result.selectedIds=plan.reviews.filter(r=>r.decision==='approve'&&!heldIds.includes(r.jobId)&&!caveatIds.has(r.jobId)).map(r=>r.jobId).concat(plan.pending.filter(r=>!heldIds.includes(r.jobId)).map(r=>r.jobId));
 const scan=await read('');const expectedRecipients=['kimchany@usc.edu','lupeter@usc.edu','xinjiaz@usc.edu','skazimi@usc.edu'];result.recipientCheck=expectedRecipients.every(x=>scan.mail?.recipients?.includes(x));
 if(result.selectedIds.length>500)throw Error('Combined selection exceeds 500 IDs');
 for(const review of plan.reviews.filter(r=>result.selectedIds.includes(r.jobId))){const audit=plan.audit.find(a=>a.id===review.jobId);if(!audit||audit.country!=='United States'||audit.failed?.length||!Number.isFinite(Date.parse(audit.date))||Date.parse(audit.date)<Date.parse(runAt)-72*3600000||Date.parse(audit.date)>Date.parse(runAt)||!review.rationale.startsWith('Keyword match (not individually reviewed)')||review.rationale.length>2000)throw Error('Final policy check failed: '+review.jobId);}
 result.reviewIds=plan.reviews.map(r=>({id:r.jobId,decision:r.decision}));
 result.held=result.held.concat(plan.audit.filter(a=>a.error||a.failed?.length).map(a=>({id:a.id,reason:a.error??a.failed})));
 if(replay){const baseline=JSON.parse(await fs.readFile(path.join(replay,'summary.json'))),old=new Set(baseline.selectedIds??[]),fresh=new Set(result.selectedIds);result.comparison={original:[...old],added:[...fresh].filter(id=>!old.has(id)),removed:[...old].filter(id=>!fresh.has(id))}; const previous=JSON.parse(await fs.readFile(path.join(replay,stamp+'-prepared.json')));result.comparison.differences=[...result.comparison.added,...result.comparison.removed].map(id=>({id,old:previous.audit.find(x=>x.id===id),replayed:plan.audit.find(x=>x.id===id),caveatHold:result.caveatHolds.find(x=>x.id===id)}));}
 if(args.includes('--exceptions')){const {exceptionForRow}=await import('./exception-run.mjs');const scan=await read(''),official=await read('-official'),context={calls:0,output:out};result.exceptions=[];for(const issue of plan.audit.filter(a=>a.error)){const row=scan.details.find(x=>x.row.id===issue.id)?.row;if(!row)continue;const evidence=official.find(x=>x.id===row.id);result.exceptions.push(await exceptionForRow(row,evidence?.text??'',issue.error,context));}result.llmTokens=result.exceptions.reduce((n,x)=>n+(x.usage?.input_tokens??0),0);}
 result.codeEvidence=codeEvidence;
 result.status='completed-shadow';
}catch(error){result.status='hold-pipeline-error';result.error=error.message;}
const after=await boundedStateRead();result.snapshotStateUnchanged=createHash('sha256').update(after).digest('hex')===stateHash;
if(!result.snapshotStateUnchanged)result.stateObservation='immutable snapshot changed during run; shadow state writes are prohibited by guard';
result.finishedAt=new Date().toISOString();await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
if(result.status!=='completed-shadow')process.exitCode=1;
