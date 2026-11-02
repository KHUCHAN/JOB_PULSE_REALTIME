// Legacy inbox extensions; exact identifiers only. Everything else is an explicit hold.
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
const [project,stamp]=process.argv.slice(2),out=process.env.JOB_PULSE_SHADOW_OUTPUT,dir=path.join(project,'.codex_tmp/review-inbox'),scanPath=path.join(project,'.codex_tmp',stamp+'.json');
const scan=JSON.parse(await fs.readFile(scanPath)),records=Object.values(JSON.parse(await fs.readFile(path.join(project,'.codex_tmp/codex-direct-db-gmail-state.json'))).records),held=[],merged=[],files=[];
const canonical=s=>{try{const u=new URL(s);u.hash='';for(const k of [...u.searchParams.keys()])if(/^(utm_|source$|src$|ref$|gh_src$|_ccid$)/i.test(k))u.searchParams.delete(k);return u.href.replace(/\/$/,'');}catch{return null;}};
const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]/g,'');
for(const name of (await fs.readdir(dir)).filter(n=>!n.startsWith('.')&&!n.endsWith('.review.json')&&/\.(pdf|docx|json|ndjson|csv|html)$/i.test(n))){
 const bytes=await fs.readFile(path.join(dir,name));files.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 try{
  let data;if(name.endsWith('.json')){const j=JSON.parse(bytes);data=Array.isArray(j)?j:j.candidates??j.jobs??[j];}else if(name.endsWith('.ndjson'))data=bytes.toString().trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));else throw Error('Unstructured inbox requires interpretation; held for supervisor review');
  if(!Array.isArray(data)||data.length>100)throw Error('Inbox shape/size requires review');
  for(const [index,c]of data.entries()){
   const id=c.jobId??c.id,url=canonical(c.officialUrl);if(!/^[a-f0-9-]{36}$/.test(id??'')||!url){held.push({name,index,reason:'Exact DB ID plus official URL required'});continue;}
   let row=scan.details.find(x=>x.row.id===id)?.row;if(!row){const r=await fetch('https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse?resource=job&id='+encodeURIComponent(id),{signal:AbortSignal.timeout(30000)});if(!r.ok){held.push({name,index,id,reason:'Exact current DB GET HTTP '+r.status});continue;}row=await r.json();}
   if(row.id!==id||canonical(row.officialUrl)!==url||row.status!=='open'){held.push({name,index,id,reason:'Exact open DB identity not verified'});continue;}
   if(records.some(r=>r.jobId===id||(r.canonicalOfficialUrl&&canonical(r.canonicalOfficialUrl)===url)||(r.requisitionId&&norm(r.company)===norm(row.company)&&norm(r.requisitionId)===norm(row.requisitionId))||norm(r.fingerprint)===norm([row.company,row.title,row.location].join('|')))||row.resumeReviewDecision||row.resumeNotifiedAt||row.resumeIdentityAlreadyNotified){held.push({name,index,id,reason:'Known/reviewed/delivered identity excluded'});continue;}
   if(!scan.details.some(x=>x.row.id===id)){scan.details.push({country:'United States',row,secondarySource:'inbox',requiresOfficialVerification:true});merged.push(id);}
  }
 }catch(error){held.push({name,reason:error.message});}
}
const report={status:'completed',files,merged,held,posts:0,llmTokens:0,policy:'Exact current DB matches enter all existing gates; unsupported/unresolved inputs held without blocking other stages'};
await fs.writeFile(scanPath,JSON.stringify(scan));await fs.writeFile(path.join(out,'inbox-stage.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
