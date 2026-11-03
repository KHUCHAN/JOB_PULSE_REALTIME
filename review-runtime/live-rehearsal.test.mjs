import './evidence-io.cjs';
// Repeated end-to-end acceptance: real live-run, preflight, archived persist,
// real live-dispatch + transport guard, snapshot state; localhost has no mail.
import {temporary,removeFixture,onCleanup,measure,snapshotProjection} from './rehearsal-support.mjs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import http from 'node:http';import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';
const code=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(code,'..'),runtime=path.resolve(repo,'../review-runtime'),snapshot=await fs.realpath(path.resolve(repo,'../runtime-root/current-snapshot')),stateRel='.codex_tmp/codex-direct-db-gmail-state.json';
const recipients=['kimchany@usc.edu','lupeter@usc.edu','xinjiaz@usc.edu','skazimi@usc.edu'],json=async(f,x)=>{await fs.mkdir(path.dirname(f),{recursive:true});await fs.writeFile(f,JSON.stringify(x));},read=async f=>JSON.parse(await fs.readFile(f)),sha=b=>createHash('sha256').update(b).digest('hex');
async function child(script,args,env){const p=spawn(script.endsWith('.py')?'/usr/local/bin/python3':process.execPath,[script,...args],{env:{...process.env,...env},cwd:repo,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);const status=await new Promise(r=>p.on('close',(code,signal)=>r({code,signal})));return {...status,stdout,stderr};}
async function fixture(mode='normal',n=3){
 const base=await temporary('job-pulse-live-'),rt=path.join(base,'review-runtime'),root=path.join(base,'runtime-root');await fs.mkdir(rt,{recursive:true});await fs.mkdir(root,{recursive:true});
 for(const name of ['preload.cjs','archive.json','versions.json','resume-match.ts','policy-preflight.mjs','persist-verified.mjs','dispatch-verified.mjs'])await fs.copyFile(path.join(runtime,name),path.join(rt,name));
 await fs.symlink(path.join(runtime,'node_modules'),path.join(rt,'node_modules'),'dir');await fs.mkdir(path.join(root,'.codex_tmp/review-inbox'),{recursive:true});
 const projection=await snapshotProjection(snapshot);await json(path.join(base,'snapshot-projection.json'),projection.provenance);
 const snap=path.join(base,'snapshot'),original=path.join(base,'original'),files=[];await fs.mkdir(path.join(snap,'.codex_tmp'),{recursive:true});
 for(const name of ['heartbeat-20261013T094302-persist-continue.mjs','heartbeat-20261013T221405-dispatch.mjs','us-dispatch-20260930.mjs','strict-official-recency.mjs','greenhouse-official-evidence.mjs','heartbeat-20260910T073856-prepare.mjs']){
  const relative='.codex_tmp/'+name,src=path.join(snapshot,relative);await fs.symlink(src,path.join(snap,relative));files.push({relative,sha256:sha(await fs.readFile(src))});
 }
 // Exercise the actual cutover transfer, including verified helper metadata.
 const keywordRel='.codex_tmp/worktrees/repair-all-20260831/lib/resume-match.ts';await fs.mkdir(path.dirname(path.join(snap,keywordRel)),{recursive:true});await fs.symlink(path.join(snapshot,keywordRel),path.join(snap,keywordRel));files.push({relative:keywordRel,sha256:sha(await fs.readFile(path.join(snapshot,keywordRel)))});
 const keywordRoot=path.join(root,'.codex_tmp/worktrees/repair-all-20260831');await fs.mkdir(keywordRoot,{recursive:true});await fs.writeFile(path.join(keywordRoot,'package.json'),'{"type":"module"}');
 await json(path.join(original,stateRel),projection.state);await json(path.join(snap,stateRel),projection.state);files.push({relative:stateRel,sha256:sha(await fs.readFile(path.join(snap,stateRel)))});
 await json(path.join(snap,'snapshot-manifest.json'),{files});await fs.symlink(snap,path.join(root,'current-snapshot'),'dir');await json(path.join(base,'automation.json'),{status:'ACTIVE'});
 const transfer=await child(path.join(code,'transition.py'),['cutover','--rehearsal-root',base],{});assert.equal(transfer.code,0,transfer.stderr);
 const calls=[],posts=[],all=[],now=new Date().toISOString(),body='This internship works on data science and machine learning projects. Build analytical software with Python and communicate model results with the engineering team. '.repeat(2);
 let server;server=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');let payload;if(req.method==='POST'){let text='';for await(const part of req)text+=part;payload=JSON.parse(text);calls.push(payload.action);posts.push(payload);}
  all.push(req.method+' '+(payload?.action??u.searchParams.get('resource')??u.pathname));const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(u.pathname.startsWith('/official/')){const j=rows.find(j=>j.officialUrl.endsWith(u.pathname));res.writeHead(200,{'content-type':'text/html'});res.end('<script type="application/ld+json">'+JSON.stringify({'@type':'JobPosting',title:j.title,description:body,datePosted:now,jobLocation:{address:{addressCountry:'US'}}})+'</script>');return;}
  if(req.method==='POST'){
   if(payload.action==='submitCodexReview'){if(mode==='401'){send({error:'unauthorized'},401);return;}for(const r of payload.reviews)if(mode!=='nondurable'||r.jobId!=='round6-0')rows.find(j=>j.id===r.jobId).resumeReviewDecision=r.decision;send({accepted:payload.reviews.length,missing:[],suppressedAlreadyNotified:[]});return;}
   for(const id of payload.jobIds)rows.find(j=>j.id===id).resumeNotifiedAt=now;
   if(mode==='timeout'){return;}
   send({alerts:{sent:1,...(payload.platformLeads?{platformLeadsSent:payload.platformLeads.length}:{})}},mode==='5xx'?500:200);return;
  }
  if(u.searchParams.get('resource')==='job'){const j=rows.find(j=>j.id===u.searchParams.get('id'));if(mode==='flip'&&!calls.length)await json(path.join(base,'automation.json'),{status:'ACTIVE'});send(j);}
  else if(u.searchParams.get('resource')==='sources')send(sources,mode==='sources'?503:200);
  else if(u.searchParams.get('resource')==='resumeAlert')send({enabled:true,gmailState:'connected',sender:recipients[0],recipients:mode==='extra-recipient'?[...recipients,'extra@example.org']:recipients});
  else send({error:'unexpected path'},404);
 });onCleanup(base,async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});await new Promise(r=>server.listen(0,'127.0.0.1',r));const endpoint='http://127.0.0.1:'+server.address().port;
 const rows=Array.from({length:n},(_,i)=>({id:'round6-'+i,title:'Data Science Intern '+i,company:'Round Six '+i,location:'Los Alamos, New Mexico',locationCountry:'US',locationRegion:'us',sourceId:'round6-source',requisitionId:'round6-req-'+i,officialUrl:endpoint+'/official/'+i,description:body,status:'open',publishedAt:mode==='bulk'?null:now,firstSeenAt:now,lastConfirmedAt:now})),sources=[{id:'round6-source',health:'healthy',postingUrl:endpoint+'/official'}];
 const reviews=rows.map(j=>({jobId:j.id,decision:'approve',rationale:'Keyword match (not individually reviewed). United States. AI or machine learning role. Official date: '+now,officialUrl:j.officialUrl,verifiedUrl:j.officialUrl,requisitionId:j.requisitionId})),audit=rows.map(j=>({id:j.id,decision:'approve',country:'United States',date:now,labels:['AI or machine learning role'],failed:[]})),official=rows.map(j=>({id:j.id,status:200,url:j.officialUrl,jsonld:[{'@type':'JobPosting',title:j.title,description:body,datePosted:now,jobLocation:{address:{addressCountry:'US'}}}]}));
 await json(path.join(base,'rehearsal-input.json'),{rows,sources,reviews,audit,official,mail:{recipients}});await fs.mkdir(path.join(root,'.codex_tmp/review-inbox'),{recursive:true});await fs.writeFile(path.join(root,'.codex_tmp/review-inbox/.codex-review-token'),'LOCAL-ONLY-NO-AUTHORITY');
 const env={JOB_PULSE_REHEARSAL:'1',JOB_PULSE_REHEARSAL_BASE:base,JOB_PULSE_RUNTIME:rt,JOB_PULSE_ENDPOINT:endpoint,JOB_PULSE_TEST_TIMEOUT:'150'};
 await measure(base,'live');
 return {base,rt,root,rows,calls,posts,all,env,setMode:m=>mode=m,close:()=>removeFixture(base),run:(extra={})=>child(path.join(code,'live-run.mjs'),[],{...env,...extra}),reconcile:()=>child(path.join(code,'reconcile.mjs'),[],env),state:()=>read(path.join(root,stateRel))};
}
const success=r=>assert.equal(r.code,0,r.stderr+'\n'+r.stdout);
for(let repeat=1;repeat<=3;repeat++)test('live rehearsal a–i iteration '+repeat,async t=>{
 for(const mode of ['normal','kill','timeout','5xx','401','sources','bulk','flip'])await t.test(mode,async()=>{const f=await fixture(mode,mode==='bulk'?21:3);try{
  const before=await f.state(),r=await f.run(mode==='kill'?{JOB_PULSE_TEST_KILL_AFTER:'submitCodexReview'}:{});
  if(mode==='normal'){success(r);const dirs=await fs.readdir(path.join(f.rt,'live-runs')),metrics=await read(path.join(f.rt,'live-runs',dirs[0],'compression.json'));assert(metrics.afterBytes<metrics.beforeBytes);if(repeat===1)console.log('live run evidence '+metrics.beforeMB.toFixed(3)+' -> '+metrics.afterMB.toFixed(3)+' MB');assert.deepEqual(f.calls,['submitCodexReview','dispatchCodexReviewBatch']);const state=await f.state();assert(Object.keys(state.records).length>=Object.keys(before.records).length+3);for(const j of f.rows)assert(Object.values(state.records).some(x=>x.jobId===j.id&&x.sentAt&&x.identityAlreadyNotified));success(await f.run());assert.deepEqual(f.calls,['submitCodexReview','dispatchCodexReviewBatch']);}
  else{assert.notEqual(r.code,0,r.stdout);const expected=['timeout','5xx'].includes(mode)?['submitCodexReview','dispatchCodexReviewBatch']:['kill','401','sources'].includes(mode)?['submitCodexReview']:[];assert.deepEqual(f.calls,expected,r.stderr);
   if(mode==='bulk'||mode==='flip')assert.equal(f.calls.length,0);
   const summaryFiles=await fs.readdir(path.join(f.rt,'live-runs'));const summary=await read(path.join(f.rt,'live-runs',summaryFiles.at(-1),'summary.json'));assert.equal(summary.status,'hold-live');
   assert((await fs.readFile(path.join(f.base,'notifications.jsonl'),'utf8')).includes('hold'));
   if(['kill','timeout','5xx'].includes(mode)){const oldCalls=[...f.calls];assert.notEqual((await f.run()).code,0);assert.deepEqual(f.calls,oldCalls);success(await f.reconcile());assert.deepEqual(f.calls,oldCalls);const state=await f.state();for(const j of f.rows)assert(Object.values(state.records).some(x=>x.jobId===j.id&&(mode==='kill'?!x.sentAt:x.sentAt)));}
   if(mode==='401')for(const j of f.rows)assert(!Object.values((await f.state()).records).some(x=>x.jobId===j.id&&x.sentAt));
   if(mode==='sources'){success(await f.reconcile());f.setMode('normal');success(await f.run());assert.deepEqual(f.calls,['submitCodexReview','dispatchCodexReviewBatch']);for(const j of f.rows)assert(Object.values((await f.state()).records).some(x=>x.jobId===j.id&&x.sentAt));}
  }
 }finally{await f.close();}});
 await t.test('g SIGKILL during atomic state write',async()=>{const f=await fixture();try{const file=path.join(f.root,stateRel),before=await fs.readFile(file),pause=path.join(f.base,'write-ready');const run=f.run({JOB_PULSE_TEST_STATE_PAUSE:pause});
  await new Promise((resolve,reject)=>{const timer=setInterval(async()=>{try{await fs.access(pause);clearInterval(timer);resolve();}catch{}},10);setTimeout(()=>{clearInterval(timer);reject(Error('writer pause missing'));},5000).unref();});process.kill(Number(await fs.readFile(pause,'utf8')),'SIGKILL');assert.notEqual((await run).code,0);assert.equal(sha(await fs.readFile(file)),sha(before));await f.state();
 }finally{await f.close();}});
});
test('endpoint override is fail closed',async()=>{for(const env of [{JOB_PULSE_ENDPOINT:'http://127.0.0.1:9'},{JOB_PULSE_REHEARSAL:'1',JOB_PULSE_ENDPOINT:'https://job-pulse-realtime.autodev61.chatgpt.site'},{JOB_PULSE_REHEARSAL:'1',JOB_PULSE_ENDPOINT:'https://example.org'}])assert.notEqual((await child(path.join(code,'live-run.mjs'),[],env)).code,0);});
test('shared Los Alamos and MD Anderson identifiers retain distinct visible requisitions',async()=>{
 const f=await fixture();try{const stamp='heartbeat-20261102T010101',out=path.join(f.base,'prepare-evidence');await fs.mkdir(out);const input=await read(path.join(f.base,'rehearsal-input.json'));
 const rows=Array.from({length:4},(_,i)=>({...input.rows[i%3],id:'shared-'+i,requisitionId:'visible-'+i,sourceId:i<2?'p5-0967-los-alamos-national-lab':'p5-0976-md-anderson-cancer-center',title:'Data Science Intern '+i,officialUrl:f.env.JOB_PULSE_ENDPOINT+'/official/shared-'+i}));
 const official=rows.map(j=>({id:j.id,status:200,url:j.officialUrl,text:(j.sourceId.includes('los-alamos')?'Req. Number: ':'Requisition #: ')+j.requisitionId,jsonld:[{'@type':'JobPosting',title:j.title,description:j.description,datePosted:j.publishedAt,identifier:{value:'shared-boilerplate'},jobLocation:{address:{addressCountry:'US'}}}]}));
 await json(path.join(out,stamp+'.json'),{runAt:new Date().toISOString(),details:rows.map(row=>({row}))});await json(path.join(out,stamp+'-official.json'),official);await json(path.join(out,'source-health.json'),rows.map(j=>({id:j.sourceId,health:'healthy'})));
 const r=await child(path.join(code,'prepare-shadow.mjs'),[f.root,f.rt,stamp],{...f.env,JOB_PULSE_PROJECT_ROOT:f.root,JOB_PULSE_SHADOW_OUTPUT:out,NODE_OPTIONS:'--require '+JSON.stringify(path.join(f.rt,'preload.cjs'))+' --require '+JSON.stringify(path.join(code,'shadow-guard.cjs'))});success(r);
 const prepared=await read(path.join(out,stamp+'-prepared.json'));assert.deepEqual(prepared.reviews.map(r=>r.requisitionId),rows.map(j=>j.requisitionId));assert.equal(f.calls.length,0);
 }finally{await f.close();}
});

test('live disk preflight holds below 5GB with no POST',async()=>{const f=await fixture();try{const r=await f.run({JOB_PULSE_TEST_FREE_BYTES:'1000'});assert.notEqual(r.code,0);assert.match(r.stderr,/hold-disk: free disk below 5GB/);assert.deepEqual(f.calls,[]);const status=await fs.readFile(path.join(f.rt,'live-status.jsonl'),'utf8');assert.match(status,/hold-disk/);assert.match(await fs.readFile(path.join(f.base,'notifications.jsonl'),'utf8'),/hold/);}finally{await f.close();}});

test('platform rows ride in the one dispatch POST, are recorded and are not sent twice',async()=>{const f=await fixture();try{
 const lead=(company,firstSeenAt)=>({platform:'LinkedIn',company,title:'Data Science Intern',locations:['Austin, TX'],url:'https://www.linkedin.com/jobs/view/1',firstSeenAt});
 await fs.writeFile(path.join(f.rt,'platform-mail-queue.json'),JSON.stringify([lead('Fresh Co',new Date().toISOString()),lead('Stale Co','2026-01-01T00:00:00.000Z')]));
 const r=await f.run();assert.equal(r.code,0,r.stderr);
 const posts=f.posts.filter(p=>p.action==='dispatchCodexReviewBatch');assert.equal(posts.length,1);assert.deepEqual(posts[0].platformLeads.map(l=>l.company),['Fresh Co']);
 const ledger=await read(path.join(f.rt,'platform-mail-ledger.json'));assert.deepEqual(ledger.map(x=>[x.company,x.status]),[['Fresh Co','sent']]);
 const dirs=await fs.readdir(path.join(f.rt,'live-runs'));assert.deepEqual((await read(path.join(f.rt,'live-runs',dirs[0],'summary.json'))).platformLeads,{offered:1,sent:1,released:0});
}finally{await f.close();}});
test('dispatch refuses an additional recipient after persistence',async()=>{const f=await fixture('extra-recipient');try{const r=await f.run();assert.notEqual(r.code,0);assert.deepEqual(f.calls,['submitCodexReview']);assert.match(r.stderr,/Gmail sender\/recipients guard failed/);}finally{await f.close();}});

test('pending dispatch row absent from scan details reconciles and permits another run',async()=>{
 const f=await fixture();try{
  const state=await f.state(),j=f.rows[0],input=await read(path.join(f.base,'rehearsal-input.json'));
  j.resumeReviewDecision='approve';state.records['req:'+j.requisitionId]={jobId:j.id,requisitionId:j.requisitionId,canonicalOfficialUrl:j.officialUrl,fingerprint:[j.company,j.title,j.location].map(x=>x.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()).join('|'),company:j.company,title:j.title,location:j.location,decision:'approve',rationale:input.reviews[0].rationale,persistedAt:new Date().toISOString(),sentAt:null,identityAlreadyNotified:false};
  await json(path.join(f.root,stateRel),state);
  success(await f.run());assert.deepEqual(f.calls,['submitCodexReview','dispatchCodexReviewBatch']);
  const dirs=await fs.readdir(path.join(f.rt,'live-runs')),out=path.join(f.rt,'live-runs',dirs[0]);
  const names=await fs.readdir(out),scan=await read(path.join(out,names.find(n=>/^heartbeat-\d{8}T\d{6}\.json$/.test(n))));
  assert(!scan.details.some(x=>x.row.id===j.id));
  assert(Object.values((await f.state()).records).some(r=>r.jobId===j.id&&r.sentAt));success(await f.run());assert.equal(f.calls.length,2);
 }finally{await f.close();}
});

test('shared requisition verification failures hold only the affected row',async()=>{
 const f=await fixture();try{const stamp='heartbeat-20261102T010102',out=path.join(f.base,'prepare-holds');await fs.mkdir(out);
  const rows=Array.from({length:10},(_,i)=>({...f.rows[0],id:'verify-'+i,title:'Data Science Intern '+i,requisitionId:'visible-'+i,sourceId:i<5?'p5-0967-los-alamos-national-lab':'p5-0976-md-anderson-cancer-center',officialUrl:f.env.JOB_PULSE_ENDPOINT+'/official/verify-'+i}));
  const official=rows.map((j,i)=>({id:j.id,status:i%5===1?403:200,url:i%5===2?j.officialUrl+'/wrong':j.officialUrl,text:i%5===3?'missing marker':(i<5?'Req. Number: ':'Requisition #: ')+j.requisitionId,jsonld:[{'@type':'JobPosting',title:i%5===4?'wrong title':j.title,description:j.description,datePosted:j.publishedAt,jobLocation:{address:{addressCountry:'US'}}}]}));
  await json(path.join(out,stamp+'.json'),{runAt:new Date().toISOString(),details:rows.map(row=>({row}))});await json(path.join(out,stamp+'-official.json'),official);await json(path.join(out,'source-health.json'),rows.map(j=>({id:j.sourceId,health:'healthy'})));
  success(await child(path.join(code,'prepare-shadow.mjs'),[f.root,f.rt,stamp],{...f.env,JOB_PULSE_PROJECT_ROOT:f.root,JOB_PULSE_SHADOW_OUTPUT:out,NODE_OPTIONS:'--require '+JSON.stringify(path.join(f.rt,'preload.cjs'))+' --require '+JSON.stringify(path.join(code,'shadow-guard.cjs'))}));
  const prepared=await read(path.join(out,stamp+'-prepared.json'));assert.deepEqual(prepared.reviews.map(r=>r.jobId),['verify-0','verify-5']);assert.equal(prepared.audit.filter(a=>a.decision==='hold'&&/Exact visible requisition verification failed/.test(a.reason)).length,8);assert.equal(f.calls.length,0);
 }finally{await f.close();}
});
test('accepted review that is not durable is quarantined, skipped by mail and never repeated',async()=>{const f=await fixture('nondurable',3);try{
 success(await f.run());assert.deepEqual(f.calls,['submitCodexReview','dispatchCodexReviewBatch']);
 let state=await f.state();assert(!Object.values(state.records).some(x=>x.jobId==='round6-0'));for(const id of ['round6-1','round6-2'])assert(Object.values(state.records).some(x=>x.jobId===id&&x.sentAt));
 const record=await read(path.join(f.rt,'PENDING_PERSISTENCE_RECONCILIATION.json'));assert.deepEqual(record.additionalUncertainAttempts.map(x=>x.jobId),['round6-0']);
 const dirs=await fs.readdir(path.join(f.rt,'live-runs'));const summary=await read(path.join(f.rt,'live-runs',dirs[0],'summary.json'));assert.equal(summary.status,'complete');assert.equal(summary.persistenceFailures[0].jobId,'round6-0');
 const oldCalls=[...f.calls];success(await f.run());assert.deepEqual(f.calls,oldCalls);
}finally{await f.close();}});
