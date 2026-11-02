import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {postingText,extractCaveats,storedCaveats,caveatClass} from './caveats.mjs';
const code=path.dirname(fileURLToPath(import.meta.url)),runtime=path.resolve(code,'../../review-runtime'),snapshot=await fs.realpath(path.resolve(runtime,'../runtime-root/current-snapshot'));
const records=Object.values(JSON.parse(await fs.readFile(path.join(snapshot,'.codex_tmp/codex-direct-db-gmail-state.json'))).records).filter(r=>r.decision==='approve'&&r.rationale?.includes('Application caveats:')).sort((a,b)=>String(b.persistedAt??b.reviewedAt).localeCompare(String(a.persistedAt??a.reviewedAt)));
const cache=path.join(runtime,'round4-caveat-text.json');let saved={};try{saved=JSON.parse(await fs.readFile(cache));}catch(e){if(e.code!=='ENOENT')throw e;}
const available=new Map();const legacy=path.join(snapshot,'legacy');
for(const name of await fs.readdir(legacy))if(/-official\.json$/.test(name))for(const e of JSON.parse(await fs.readFile(path.join(legacy,name)))){
 const ld=e.jsonld?.find(x=>x['@type']==='JobPosting');const h=e.apiDerivedPosting?.description??e.ats?.data?.jobPostingInfo?.jobDescription??ld?.description??ld?.Description;
 if(h)available.set(e.id,postingText(h));
}
const rows=[],unavailable=[];let gets=0;
for(const r of records){if(rows.length>=60)break;
 let text=available.get(r.jobId)??saved[r.jobId];let origin=available.has(r.jobId)?'saved official evidence':'cached DB GET';
 if(!text&&!Object.hasOwn(saved,r.jobId)){const response=await fetch('https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse?resource=job&id='+encodeURIComponent(r.jobId),{signal:AbortSignal.timeout(20000)});gets++;if(response.ok){const j=await response.json();text=postingText([j.description,j.responsibilities,j.qualifications].filter(Boolean).join('\n'));saved[r.jobId]=text;origin='DB GET';}}
 if(!text||text.length<160){unavailable.push({id:r.jobId,class:'text unavailable/short'});continue;}
 const extracted=extractCaveats(text),stored=storedCaveats(r.rationale),misses=[];let reproduced=0;
 for(const sentence of stored){if(extracted.join(' ').includes(sentence))reproduced++;else misses.push({sentence,class:text.includes(sentence)?(caveatClass(sentence)??'historical non-restriction prose'):'source-text-unavailable',caveatClass:caveatClass(sentence)??'unclassified',presentInText:text.includes(sentence)});}
 rows.push({id:r.jobId,origin,textLength:text.length,stored:stored.length,reproduced,misses,extra:extracted.filter(s=>!stored.some(t=>s.includes(t)))});
}
await fs.writeFile(cache,JSON.stringify(saved));const report={at:new Date().toISOString(),rows:rows.length,sentences:rows.reduce((n,r)=>n+r.stored,0),reproduced:rows.reduce((n,r)=>n+r.reproduced,0),gets,unavailable,details:rows};await fs.writeFile(path.join(runtime,'round4-caveat-recall.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({rows:report.rows,sentences:report.sentences,reproduced:report.reproduced,gets,misses:rows.flatMap(r=>r.misses.map(m=>({id:r.id,...m})))}));
if(rows.length<50)process.exitCode=1;
