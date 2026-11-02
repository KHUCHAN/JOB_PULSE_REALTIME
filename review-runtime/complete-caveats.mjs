// Complete only fresh, unpersisted rationales with exact official text.
import fs from 'node:fs/promises';
import path from 'node:path';
const [project,stamp]=process.argv.slice(2),out=process.env.JOB_PULSE_SHADOW_OUTPUT;
const root=path.join(project,'.codex_tmp'),file=s=>path.join(root,stamp+s+'.json');
const log=await fs.readFile(path.join(out,'caveat-audit-prepersist.log'),'utf8');
const missing=JSON.parse(log.slice(0,log.lastIndexOf(']')+1));
const plan=JSON.parse(await fs.readFile(file('-us-plan'))),prep=JSON.parse(await fs.readFile(file('-prepared'))),held=[];
for(const row of missing){const review=plan.reviews.find(x=>x.jobId===row.id);if(!review||review.decision!=='approve')continue;
 const additions=row.missing.filter(text=>!review.rationale.includes(text));
 const next=review.rationale+(review.rationale.includes('Application caveats:')?' | ':'. Application caveats: ')+additions.join(' | ');
 if(next.length>2000){held.push({id:row.id,reason:'Exact caveats exceed endpoint limit; no truncation or persisted amendment',missing:row.missing});continue;}
 review.rationale=next;
}
prep.reviews=plan.reviews;await fs.writeFile(file('-us-plan'),JSON.stringify(plan));await fs.writeFile(file('-prepared'),JSON.stringify(prep));
await fs.writeFile(path.join(out,'caveat-holds.json'),JSON.stringify(held));
console.log(JSON.stringify({completed:missing.length-held.length,held:held.map(x=>x.id)}));
