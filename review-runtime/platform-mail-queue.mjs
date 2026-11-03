// Daily lane: queues today's Handshake and LinkedIn rows that the DB lacks. No LLM. Sending happens in the next live run.
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
import {US_LOCATION} from './handshake-policy.mjs';import {QUEUE,mailExcluded,mergeQueue,readLedger,sameLead} from './platform-mail.mjs';
const {atomic}=createRequire(import.meta.url)('./atomic-state.cjs');
const dir=path.dirname(fileURLToPath(import.meta.url)),runtime=process.env.JOB_PULSE_RUNTIME??path.resolve(dir,'../../review-runtime'),root=process.env.JOB_PULSE_ROOT??path.resolve(dir,'../../runtime-root');
const api='https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse',MAX_LOOKUPS=60,now=new Date().toISOString(),day=process.env.JOB_PULSE_DAY??now.slice(0,10),base=path.join(runtime,'platform-runs',day);
const readJson=(file,fallback)=>fs.readFile(file,'utf8').then(JSON.parse,e=>{if(e.code==='ENOENT')return fallback;throw e;});
const cleanUrl=value=>{const u=new URL(value);u.search='';u.hash='';return u.href;};
const rowsOf=async(name,platform)=>{const r=await readJson(path.join(base,name),{});return [...(r.gaps??[]).map(x=>({...x,checked:true})),...(r.notInInventory??[])].filter(x=>x.company&&x.title&&x.platformUrl&&US_LOCATION.test(x.location??'')).map(x=>({...x,platform,platformUrl:cleanUrl(x.platformUrl)}));};
const read=[...await rowsOf('handshake-leads.json','Handshake'),...await rowsOf('linkedin-leads.json','LinkedIn')],rows=read.filter(r=>!mailExcluded(r));
const queue=await readJson(path.join(runtime,QUEUE),[]),ledger=await readLedger(runtime),state=await readJson(path.join(root,'.codex_tmp/codex-direct-db-gmail-state.json'),{records:{}}),records=Object.values(state.records);
const seen=[...queue,...ledger,...records],fresh=[];let inDb=0,known=0,lookupErrors=0,lookups=0,deferred=0;
for(const row of rows){
 if(seen.some(x=>sameLead(x,row))){known++;continue;}
 // Rows from employers with a source were looked up already; the rest may sit under another name in the DB.
 if(!row.checked){
  if(lookups>=MAX_LOOKUPS){deferred++;continue;}lookups++;
  const u=new URL(api);u.search=new URLSearchParams({resource:'jobs',q:row.title,pageSize:'20'}).toString();
  try{const r=await fetch(u,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);if((await r.json()).items.some(x=>sameLead(x,row))){inDb++;continue;}}catch{lookupErrors++;continue;}
 }
 fresh.push(row);
}
const merged=mergeQueue(queue,fresh,now);
atomic(path.join(runtime,QUEUE),JSON.stringify(merged.queue,null,1));
const report={at:now,rows:rows.length,excluded:read.length-rows.length,added:merged.added.length,alreadyKnown:known,inDb,lookupErrors,deferred,queued:merged.queue.length};
await fs.mkdir(base,{recursive:true});await fs.writeFile(path.join(base,'mail-queue.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
