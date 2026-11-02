import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {canonical,companyKey,norm} from './community-discovery.mjs';
const [project,runtime,stamp]=process.argv.slice(2);
assert(/^heartbeat-\d{8}T\d{6}$/.test(stamp),'Fresh run stamp required');
const root=path.join(project,'.codex_tmp'),scanPath=path.join(root,stamp+'.json');
const discovery=JSON.parse(await fs.readFile(path.join(process.env.JOB_PULSE_SHADOW_OUTPUT??path.join(runtime,'runs',stamp),'community-discovery.json'),'utf8'));
const scan=JSON.parse(await fs.readFile(scanPath,'utf8'));
assert(Date.parse(scan.runAt)===Date.parse(discovery.runAt)&&scan.cutoff===discovery.cutoff,'Cross-run merge forbidden');
assert(Object.values(scan.scans??{}).length>0&&Object.values(scan.scans).every(s=>s.stop&&s.stop!=='failure'),'Collect bounded raw DB pages before merging');
const records=Object.values(JSON.parse(await fs.readFile(path.join(root,'codex-direct-db-gmail-state.json'),'utf8')).records);
const urls=new Set(records.map(r=>canonical(r.canonicalOfficialUrl)).filter(Boolean));
const reqs=new Set(records.filter(r=>r.requisitionId).map(r=>companyKey(r.company)+'|'+norm(r.requisitionId)));
const fps=new Set(records.map(r=>[companyKey(r.company),norm(r.title),norm(r.location)].join('|')));
const report={stamp,runAt:scan.runAt,merged:[],excluded:[],requiresFullExistingOfficialKeywordAndDispatchGates:true,reviewWrites:0,emailsSent:0};
for(const d of discovery.details){if(scan.details.some(x=>x.row.id===d.row.id)){report.excluded.push({id:d.row.id,reason:'Already in this run raw scan'});continue;}
 const r=await fetch('https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse?resource=job&id='+encodeURIComponent(d.row.id),{signal:AbortSignal.timeout(30000)});assert(r.ok,'Fresh exact DB GET failed');const j=await r.json();assert(j.id===d.row.id&&canonical(j.officialUrl)===canonical(d.row.officialUrl),'Exact DB identity changed');
 const known=urls.has(canonical(j.officialUrl))||(j.requisitionId&&reqs.has(companyKey(j.company)+'|'+norm(j.requisitionId)))||fps.has([companyKey(j.company),norm(j.title),norm(j.location)].join('|'));
 if(known||j.resumeReviewDecision||j.resumeNotifiedAt||j.resumeIdentityAlreadyNotified||j.status==='closed'){report.excluded.push({id:j.id,reason:'Durable known/reviewed/delivered or closed'});continue;}
 scan.details.push({...d,row:j,country:'United States',secondarySource:'community',requiresOfficialVerification:true});report.merged.push(j.id);
}
scan.communityDiscovery={evidence:path.join(process.env.JOB_PULSE_SHADOW_OUTPUT??path.join(runtime,'runs',stamp),'community-discovery.json'),newExactRows:discovery.details.length,merged:report.merged,gaps:discovery.gaps};
await fs.writeFile(path.join(process.env.JOB_PULSE_SHADOW_OUTPUT??path.join(runtime,'runs',stamp),'community-merge.json'),JSON.stringify(report,null,2),{flag:'wx'});
await fs.writeFile(scanPath,JSON.stringify(scan,null,2));
console.log(JSON.stringify(report));
