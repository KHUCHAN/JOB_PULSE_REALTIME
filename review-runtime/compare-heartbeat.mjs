// Foreground, offline aligned comparison. Never rescan today's mutable DB.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const code=path.dirname(fileURLToPath(import.meta.url));
const runtime=process.env.JOB_PULSE_RUNTIME??path.resolve(code,'../../review-runtime');
const stamp=process.argv[2];if(!/^heartbeat-\d{8}T\d{6}$/.test(stamp??''))throw Error('Pass exact legacy heartbeat name');
const snapshot=await fs.realpath(path.resolve(runtime,'../runtime-root/current-snapshot'));
const meta=JSON.parse(await fs.readFile(path.join(snapshot,'snapshot-manifest.json')));
if(meta.heartbeat!==stamp)throw Error('Snapshot does not contain that heartbeat; foreground snapshot --heartbeat '+stamp+' first');
const legacy=path.join(snapshot,'legacy'),read=async name=>JSON.parse(await fs.readFile(path.join(legacy,name)));
const scan=await read(stamp+'.json'),selection=await read('selection-manifest.json'),dispatch=await read(stamp+'-us-dispatch-plan.json');
if(!Array.isArray(selection.selectedIds)||JSON.stringify(selection.selectedIds)!==JSON.stringify(dispatch.selected))throw Error('Actual legacy selection evidence disagrees');
const baseline=path.join(runtime,'aligned-inputs',stamp+'-'+Date.now());await fs.mkdir(baseline,{recursive:true});
for(const name of await fs.readdir(legacy))if(name.startsWith(stamp)&&name.endsWith('.json')){await fs.copyFile(path.join(legacy,name),path.join(baseline,name));await fs.chmod(path.join(baseline,name),0o600);}
await fs.writeFile(path.join(baseline,'summary.json'),JSON.stringify({stamp,runAt:scan.runAt,selectedIds:selection.selectedIds}));
const child=spawn(process.execPath,[path.join(code,'review-run.mjs'),'--replay',baseline],{env:process.env,stdio:['ignore','pipe','inherit']});
const finished=new Promise(resolve=>child.on('close',resolve));let stdout='';for await(const chunk of child.stdout)stdout+=chunk;const exit=await finished;
const report=JSON.parse(stdout.trim());
report.alignment={legacyHeartbeat:stamp,runAt:scan.runAt,snapshotAt:Object.fromEntries(Object.entries(scan.scans).map(([country,s])=>[country,s.snapshotAt])),actualLegacySelectedIds:selection.selectedIds,scan:'saved raw pages and saved official evidence; offline network denied',history:'current snapshot projected before legacy run; original pre-run state was not retained'};
const original=new Set(selection.selectedIds),fresh=new Set(report.selectedIds??[]);
const prep=JSON.parse(await fs.readFile(path.join(report.out,stamp+'-prepared.json')));
report.alignment.differences=[...new Set([...original,...fresh])].filter(id=>original.has(id)!==fresh.has(id)).map(id=>({id,legacySelected:original.has(id),shadowSelected:fresh.has(id),legacyAudit:selection.reviews.find(r=>r.jobId===id)??null,shadowAudit:prep.audit.find(r=>r.id===id)??null,caveatHold:report.caveatHolds?.find(r=>r.id===id)??null,explanation:'Compare saved legacy decision and deterministic gate evidence; historical identity history is projected, not a frozen pre-run state.'}));
// Explain the supervisor's earlier unaligned 07:11/07:19 comparisons using
// their saved inputs, never by comparing against today's mutable DB.
report.priorUnalignedComparisons=[];
if(stamp==='heartbeat-20261102T055005'){
 const rawIds=new Set(Object.values(scan.scans).flatMap(s=>s.pages.flatMap(p=>p.items.map(j=>j.id))));
 const boundary=Math.max(...Object.values(scan.scans).map(s=>Date.parse(s.snapshotAt)));
 for(const name of await fs.readdir(path.join(runtime,'shadow-runs'))){
  if(!/^shadow-heartbeat-20261102T07(?:11|19)/.test(name))continue;
  const dir=path.join(runtime,'shadow-runs',name),previous=JSON.parse(await fs.readFile(path.join(dir,'summary.json'))),input=JSON.parse(await fs.readFile(path.join(dir,previous.stamp+'.json')));
  report.priorUnalignedComparisons.push({runAt:previous.runAt,selected:previous.selectedIds.map(id=>{
   const row=input.details.find(x=>x.row.id===id)?.row;
   return {id,title:row?.title,firstSeenAt:row?.firstSeenAt,publishedAt:row?.publishedAt,inLegacyRawPages:rawIds.has(id),
    explanation:Date.parse(row?.firstSeenAt)>boundary?'Collected after the legacy fixed scan boundary; absent from that heartbeat input.':!rawIds.has(id)&&!row?.publishedAt?'Undated DB row absent from the legacy saved pages. The pre-policy helper used jobs/postedAfter; the later reviewJobs scan includes undated first-seen candidates. Input/query coverage differs; no aligned gate-selection difference was observed.':!rawIds.has(id)?'Absent from legacy saved raw pages; different scan input, not an observed aligned gate disagreement.':'Present in both inputs; compare gate audit evidence.'};
  })});
 }
}
await fs.writeFile(path.join(report.out,'aligned-comparison.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=exit;
