import {comparePolicy} from './comparison-policy.mjs';
// Read-only aligned comparison: saved evidence first; explicit fixed-boundary re-fetch fallback.
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';
const code=path.dirname(fileURLToPath(import.meta.url)),runtime=process.env.JOB_PULSE_RUNTIME??path.resolve(code,'../../review-runtime');
const snapshot=await fs.realpath(path.resolve(runtime,'../runtime-root/current-snapshot')),meta=JSON.parse(await fs.readFile(path.join(snapshot,'snapshot-manifest.json')));
const stamp=process.argv[2]==='--snapshot-heartbeat'?meta.heartbeat:process.argv[2];if(!/^heartbeat-\d{8}T\d{6}$/.test(stamp??''))throw Error('Pass exact legacy heartbeat name');
if(meta.heartbeat!==stamp)throw Error('Foreground snapshot --heartbeat '+stamp+' first');
const legacy=path.join(snapshot,'legacy'),read=async n=>JSON.parse(await fs.readFile(path.join(legacy,n))),optional=async n=>read(n).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
const summary=await optional('summary.json'),selection=await read('selection-manifest.json'),dispatch=await optional(stamp+'-us-dispatch-plan.json');
if(dispatch&&JSON.stringify(selection.selectedIds)!==JSON.stringify(dispatch.selected))throw Error('Legacy selection evidence disagrees');
const baseline=path.join(runtime,'aligned-inputs',stamp+'-'+Date.now());await fs.mkdir(baseline,{recursive:true});
for(const n of await fs.readdir(legacy))if(n.endsWith('.json')){await fs.copyFile(path.join(legacy,n),path.join(baseline,n));await fs.chmod(path.join(baseline,n),0o600);}
let scan=await optional(stamp+'.json'),provenance='saved raw pages and saved official evidence; network denied during gate replay';
if(process.argv.includes('--refetch')||!scan||!Object.values(scan.scans).every(s=>Array.isArray(s.pages)&&s.pages.every(p=>Array.isArray(p.items)))){
 const runAt=summary?.runAt??scan?.runAt,cutoff=new Date(Date.parse(runAt)-72*3600000).toISOString();
 const scans={},details=[];const records=Object.values(JSON.parse(await fs.readFile(path.join(snapshot,'.codex_tmp/codex-direct-db-gmail-state.json'))).records).filter(r=>r.persistedAt&&r.persistedAt<runAt);
 const prior=new Set(records.map(r=>r.jobId));
 for(const [country,s]of Object.entries(summary?.rawScan??scan?.scans??{})){
  if(!s.snapshotAt)throw Error('No heartbeat fixed snapshotAt evidence');const pages=[];
  for(let page=1;page<=5;page++){
   // Omit current unreviewed filter: it is not time-travel aware. Project local history before runAt instead.
   const q=new URLSearchParams({resource:'reviewJobs',region:'us',postedAfter:cutoff.slice(0,10),resumeMatch:'chanyoung-resume',sort:'publishedAt',order:'desc',pageSize:'100',page:String(page),snapshotAt:s.snapshotAt});q.append('program','internship');q.append('program','coop');
   const response=await fetch('https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse?'+q,{signal:AbortSignal.timeout(55000)});if(!response.ok)throw Error('Re-fetch HTTP '+response.status);const data=await response.json();if(data.snapshotAt!==s.snapshotAt)throw Error('Re-fetch snapshot mismatch');pages.push(data);
   for(const row of data.items)if(!prior.has(row.id))details.push({country,page,row});if(data.items.length<100||page*100>=data.total)break;if(page===5)break;
  }scans[country]={pages,snapshotAt:s.snapshotAt,stop:pages.at(-1).total>pages.length*100?'five-page backlog':'end'};
 }
 const decisionIds=new Set(selection.reviews.map(r=>r.jobId));
 const historicalDetails=scan?.details??details.filter(x=>decisionIds.has(x.row.id));
 for(const review of selection.reviews)if(!historicalDetails.some(x=>x.row.id===review.jobId)){const response=await fetch('https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse?resource=job&id='+encodeURIComponent(review.jobId));if(!response.ok)throw Error('Historical decision row unavailable '+review.jobId);const row=await response.json();if(Date.parse(row.firstSeenAt)>Math.max(...Object.values(scans).map(x=>Date.parse(x.snapshotAt))))throw Error('Row after heartbeat boundary');historicalDetails.push({country:'United States',row});}
 scan={...scan,runAt,cutoff,scans,details:historicalDetails,mail:scan?.mail??{recipients:summary.gmailVerification.recipients},inbox:scan?.inbox??[],skipped:scan?.skipped??[]};
 provenance='RE-FETCH of reviewJobs at heartbeat fixed snapshotAt; current unreviewed filter omitted and history projected before runAt. snapshotAt bounds firstSeenAt only; mutable catalog/body fields are not historical snapshots. Saved candidate details retained when available.';
 await fs.writeFile(path.join(baseline,stamp+'.json'),JSON.stringify(scan));
}
if(!await optional(stamp+'-official.json')){
 const env={...process.env,JOB_PULSE_PROJECT_ROOT:snapshot,JOB_PULSE_SHADOW_OUTPUT:baseline};
 for(const mode of ['official-fast','enrich','vendor-details']){const child=spawn(process.execPath,['--require',path.join(code,'desktop-guard.cjs'),'--require',path.join(runtime,'preload.cjs'),'--require',path.join(code,'shadow-guard.cjs'),path.join(runtime,'review-stage.mjs'),snapshot,stamp,scan.runAt,mode],{env,stdio:['ignore','ignore','inherit']});const exit=await new Promise(r=>child.on('close',r));if(exit)throw Error('Official evidence re-fetch failed '+mode);}
 provenance+=' OFFICIAL EVIDENCE RE-FETCHED NOW; this is not historical body equivalence.';
}
for(const suffix of ['-prepared','-us-plan'])if(!await optional(stamp+suffix+'.json'))await fs.writeFile(path.join(baseline,stamp+suffix+'.json'),JSON.stringify({reviews:selection.reviews,audit:[],pending:[]}));
await fs.writeFile(path.join(baseline,'summary.json'),JSON.stringify({stamp,runAt:scan.runAt,selectedIds:selection.selectedIds}));
const child=spawn(process.execPath,[path.join(code,'review-run.mjs'),'--replay',baseline],{env:process.env,stdio:['ignore','pipe','inherit']});const finished=new Promise(resolve=>child.on('close',resolve));let stdout='';for await(const chunk of child.stdout)stdout+=chunk;const exit=await finished,report=JSON.parse(stdout.trim());
if(!report.out)throw Error('Gate replay did not start: '+JSON.stringify(report));
const plan=JSON.parse(await fs.readFile(path.join(report.out,stamp+'-us-plan.json'))),old=new Map(selection.reviews.map(r=>[r.jobId,r])),fresh=new Map(plan.reviews.map(r=>[r.jobId,r]));
const payload=(review,row)=>({company:row.company,title:row.title,location:row.location||'Location not specified',timing:row.publishedAt?`Posted ${row.publishedAt.slice(0,10)}`:`First seen ${row.firstSeenAt.slice(0,10)}`,reasons:[review.rationale.trim()],officialUrl:review.verifiedUrl||row.officialUrl,score:row.resumeMatchScore??row.matchScore,program:/co[- ]?op/i.test(row.title+' '+row.employmentType)?'Co-op':'Internship',scheduleNote:null});
const differences=[];for(const id of new Set([...old.keys(),...fresh.keys()])){const a=old.get(id),b=fresh.get(id);if(a?.decision!==b?.decision)differences.push({id,legacy:a?.decision??null,shadow:b?.decision??null,legacyRationale:a?.rationale,shadowRationale:b?.rationale,audit:plan.audit.find(x=>x.id===id),cause:!b?'Candidate excluded by deterministic identity/source/gate audit; see audit':!a?'Additional candidate in saved input; legacy withheld it outside its decision set':'Deterministic gate result differs; failed gate names and saved rationale identify the cause'});}
const ruleSource=await fs.readFile(path.join(code,'../lib/resume-match.ts'),'utf8');
const keywordLabels=[...ruleSource.slice(ruleSource.indexOf('const roleEvidence'),ruleSource.indexOf('const educationEvidence')).matchAll(/label: "([^"]+)"/g)].map(m=>m[1]);
const comparisonInputs={legacy:[...old.values()],fresh:[...fresh.values()],rows:scan.details.map(x=>x.row),audit:plan.audit,legacySelected:selection.selectedIds,freshSelected:report.selectedIds,keywordLabels};
const acceptance=comparePolicy(comparisonInputs);
for(const difference of differences){const explanation=[...acceptance.explainedUndatedDifferences,...acceptance.explainedMissingEvidenceDifferences].find(x=>x.id===difference.id);if(explanation)difference.cause=explanation.reason;}
const approved=[...old.values()].filter(a=>a.decision==='approve').map(a=>({id:a.jobId,legacyRationale:a.rationale,shadowRationale:fresh.get(a.jobId)?.rationale}));
const stored=Object.values(JSON.parse(await fs.readFile(path.join(snapshot,'.codex_tmp/codex-direct-db-gmail-state.json'))).records);
for(const row of approved)row.legacyMatchesStoredRationale=stored.find(r=>r.jobId===row.id)?.rationale===row.legacyRationale;
report.alignment={acceptance,comparisonInputs,legacyHeartbeat:stamp,runAt:scan.runAt,snapshotAt:Object.fromEntries(Object.entries(scan.scans).map(([k,s])=>[k,s.snapshotAt])),scan:provenance,history:'Current history projected strictly before runAt in memory; no frozen pre-run state was retained',legacyDecisions:old.size,shadowDecisions:fresh.size,legacyApproved:[...old.values()].filter(x=>x.decision==='approve').length,shadowApproved:[...fresh.values()].filter(x=>x.decision==='approve').length,decisionDifferences:differences,approved,rawPageCounts:Object.fromEntries(Object.entries(scan.scans).map(([k,s])=>[k,{pages:s.pages.length,rows:s.pages.reduce((n,p)=>n+p.items.length,0),stop:s.stop}])),mailPayloadMethod:'Projected using lib/resume-alert-store.ts: stored rationale is the entire reasons[0], timing uses DB publishedAt/firstSeenAt. No mail POST; original rendered MIME was not retained.',actualLegacySelectedIds:selection.selectedIds};
await fs.writeFile(path.join(report.out,'aligned-comparison.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,out:report.out,legacyDecisions:old.size,shadowDecisions:fresh.size,acceptance}));process.exitCode=exit|| (acceptance.accepted?0:1);
