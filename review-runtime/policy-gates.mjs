// Read-only final validation of fresh decisions. No reclassification on absence.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {recent} from './date-policy.mjs';
const [project,stamp]=process.argv.slice(2),out=process.env.JOB_PULSE_SHADOW_OUTPUT;
const plan=JSON.parse(await fs.readFile(path.join(out,stamp+'-us-plan.json'))),scan=JSON.parse(await fs.readFile(path.join(out,stamp+'.json')));
for(const r of plan.reviews){const a=plan.audit.find(x=>x.id===r.jobId);assert(a&&a.decision===r.decision);assert(r.rationale.length<=2000);assert(r.rationale.startsWith('Keyword match (not individually reviewed)'));
 if(r.decision==='approve'){assert(!a.failed.length&&a.country==='United States'&&a.labels.length);assert(recent(a.date,scan.runAt));}
 else assert(/^(?:affirmative non-US location|affirmative no keyword fit on available text|closed posting|old official date|affirmative non-internship program)$/.test(a.reason),'Missing evidence cannot authorize reject');
}
console.log(JSON.stringify({reviews:plan.reviews.length,validated:true}));
