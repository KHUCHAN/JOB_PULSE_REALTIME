// Reads LinkedIn's logged-out public listings with plain requests, so this stage uses no tokens. It stops at the first refusal and never retries.
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {HANDSHAKE_QUERIES} from './handshake-policy.mjs';import {parseLinkedinCards,selectLinkedinLeads} from './platform-policy.mjs';import {findGaps} from './platform-gaps.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),runtime=process.env.JOB_PULSE_RUNTIME??path.resolve(dir,'../../review-runtime');
const day=new Date().toISOString().slice(0,10),root=path.join(runtime,'platform-runs',day),reportPath=path.join(root,'linkedin-leads.json');await fs.mkdir(root,{recursive:true});
const finish=async report=>{await fs.writeFile(reportPath,JSON.stringify({at:new Date().toISOString(),...report},null,2));const {gaps,notInInventory,...brief}=report;console.log(JSON.stringify({...brief,gaps:gaps?.length,notInInventory:notInInventory?.length}));process.exit(0);};
const rows=[];let stopped=null,read=0;
for(const keywords of HANDSHAKE_QUERIES){
 const u=new URL('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search');u.search=new URLSearchParams({keywords,location:'United States',f_TPR:'r259200',start:'0'}).toString();
 try{const r=await fetch(u,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);if(/\/(authwall|login|checkpoint)/.test(new URL(r.url).pathname))throw Error('login wall');rows.push(...parseLinkedinCards(await r.text()));read++;}catch(e){stopped=e.message;break;}
 await new Promise(resolve=>setTimeout(resolve,3000));
}
if(!rows.length)await finish({status:'unavailable',reason:stopped??'No job cards found on the public page'});
const leads=selectLinkedinLeads(rows),reason=stopped?`Stopped after ${read} of ${HANDSHAKE_QUERIES.length} queries: ${stopped}`:undefined,unique=new Set(rows.map(r=>r.platformUrl)).size;
const found=await findGaps(leads,runtime,day);
if(!found)await finish({status:'checked',reason:'Source inventory unavailable; no gaps computed',rows:rows.length,unique,selected:leads.length});
await finish({status:'checked',reason,rows:rows.length,unique,selected:leads.length,inDb:found.inDb,lookupErrors:found.lookupErrors,gaps:found.gaps.slice(0,12),notInInventory:found.notInInventory.map(({company,title,location,platformUrl})=>({company,title,location,platformUrl}))});
