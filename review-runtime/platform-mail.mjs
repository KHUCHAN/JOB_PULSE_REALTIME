// Handshake and LinkedIn rows go into the digest without an official-page check.
// The ledger is permanent: a row is reserved before the POST and comes back only when the server proves the mail left it out.
import fs from 'node:fs/promises';import path from 'node:path';import {createRequire} from 'node:module';
const {atomic}=createRequire(import.meta.url)('./atomic-state.cjs');
export const QUEUE='platform-mail-queue.json',LEDGER='platform-mail-ledger.json',PLAN='platform-leads.json',MAIL_LIMIT=20;
const WINDOW_MS=72*3600000,KEEP_MS=30*86400000;
const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const readJson=(file,fallback)=>fs.readFile(file,'utf8').then(JSON.parse,e=>{if(e.code==='ENOENT')return fallback;throw e;});
// Titles must match exactly; employer names may differ by a suffix, such as "TikTok USDS Joint Venture" and "TikTok".
const sameCompany=(a,b)=>{const x=norm(a),y=norm(b);return !!x&&!!y&&(x===y||x.startsWith(y+' ')||y.startsWith(x+' '));};
export const sameLead=(a,b)=>!!norm(a.title)&&norm(a.title)===norm(b.title)&&sameCompany(a.company,b.company);
// The user excluded military transition programs and roles only for undergraduates. A title naming graduates as well stays.
export const mailExcluded=({title})=>/skillbridge/i.test(title)||(/\bundergrad/i.test(title)&&!/\b(?:grad(?:uate)?s?|masters?|master's|mba|ph\.?d)\b/i.test(title.replace(/\bundergrad\w*/gi,'')));
export const readLedger=runtime=>readJson(path.join(runtime,LEDGER),[]);
export const readPlanLeads=()=>readJson(path.join(process.env.JOB_PULSE_SHADOW_OUTPUT,PLAN),[]);
export function mergeQueue(queue,rows,now){
 const kept=queue.filter(l=>Date.parse(now)-Date.parse(l.firstSeenAt)<=KEEP_MS).map(l=>({...l,locations:[...l.locations]})),added=[];
 for(const row of rows){
  const match=[...kept,...added].find(l=>sameLead(l,row));
  if(match){if(row.location&&!match.locations.includes(row.location))match.locations.push(row.location);continue;}
  added.push({platform:row.platform,company:row.company,title:row.title,locations:row.location?[row.location]:[],url:row.platformUrl,firstSeenAt:now});
 }
 return {queue:[...kept,...added],added};
}
// Oldest first so nothing expires while a backlog drains; Handshake first within a day.
export function selectForMail(queue,ledger,records,now,limit=MAIL_LIMIT){
 const titles=new Set(queue.map(l=>norm(l.title))),known=[...ledger,...records.filter(r=>titles.has(norm(r.title)))];
 return queue.filter(l=>Date.parse(now)-Date.parse(l.firstSeenAt)<=WINDOW_MS&&!known.some(x=>sameLead(x,l)))
  .sort((a,b)=>a.firstSeenAt.localeCompare(b.firstSeenAt)||(a.platform==='Handshake'?0:1)-(b.platform==='Handshake'?0:1)).slice(0,limit);
}
const place=l=>l.length>3?l.slice(0,3).join('; ')+` +${l.length-3} more`:l.join('; ');
export const toPayload=l=>({platform:l.platform,company:l.company,title:l.title,location:place(l.locations),firstSeen:l.firstSeenAt.slice(0,10),url:l.url});
// Runs after persistence, so the records already hold every row this mail can select.
export async function reservePlatformLeads({runtime,root,out,now=new Date().toISOString()}){
 const queue=await readJson(path.join(runtime,QUEUE),[]);if(!queue.length)return [];
 const ledger=await readLedger(runtime),state=JSON.parse(await fs.readFile(path.join(root,'.codex_tmp/codex-direct-db-gmail-state.json'),'utf8'));
 const leads=selectForMail(queue,ledger,Object.values(state.records),now);if(!leads.length)return [];
 atomic(path.join(runtime,LEDGER),JSON.stringify([...ledger,...leads.map(l=>({platform:l.platform,company:l.company,title:l.title,url:l.url,status:'attempting',at:now}))]));
 await fs.writeFile(path.join(out,PLAN),JSON.stringify(leads.map(toPayload)),{flag:'wx'});
 return leads;
}
// A failed or unknown POST never reaches this point or stays 'attempting', so those rows are not offered again.
export async function settlePlatformLeads({runtime,out,stamp,leads,now=new Date().toISOString()}){
 if(!leads.length)return {offered:0,sent:0,released:0};
 const receipt=await readJson(path.join(out,stamp+'-us-dispatch.json'),null),alerts=receipt?.result?.alerts;
 const delivered=receipt?.phase==='responded'&&receipt.status===200&&alerts?.sent===1,count=alerts?.platformLeadsSent;
 // No POST at all, or a server that does not know the field: those rows were not in any mail.
 const release=!receipt||(delivered&&count===undefined),sent=delivered&&count!==undefined;
 if(!release&&!sent)return {offered:leads.length,sent:0,released:0,uncertain:leads.length};
 const ledger=await readLedger(runtime),mine=x=>x.status==='attempting'&&leads.some(l=>sameLead(l,x));
 atomic(path.join(runtime,LEDGER),JSON.stringify(release?ledger.filter(x=>!mine(x)):ledger.map(x=>mine(x)?{...x,status:'sent',at:now,stamp}:x)));
 return {offered:leads.length,sent:sent?count:0,released:release?leads.length:0};
}
