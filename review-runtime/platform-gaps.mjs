// Finds which selected rows are missing from the DB and records employers the catalog lacks. No LLM.
import fs from 'node:fs/promises';import path from 'node:path';
import {splitByInventory,updateSourceGaps,norm} from './handshake-policy.mjs';
const api='https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse';
export async function findGaps(leads,runtime,day){
 const inventory=await fetch(api+'?resource=sources',{signal:AbortSignal.timeout(30000)}).catch(()=>null);if(!inventory?.ok)return null;
 const sources=await inventory.json(),{inInventory,notInInventory}=splitByInventory(leads,sources),gaps=[];let inDb=0,lookupErrors=0;
 const gapsPath=path.join(runtime,'source-gaps.json');let ledger={};try{ledger=JSON.parse(await fs.readFile(gapsPath,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.writeFile(gapsPath,JSON.stringify(updateSourceGaps(ledger,notInInventory,day,sources),null,2));
 for(const lead of inInventory.slice(0,40)){
  const u=new URL(api);u.search=new URLSearchParams({resource:'jobs',company:lead.company,q:lead.title,pageSize:'20',resumeMatch:'chanyoung-resume'}).toString();
  try{const r=await fetch(u,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);const {items}=await r.json();if(items.some(x=>norm(x.title)===norm(lead.title)))inDb++;else gaps.push(lead);}catch{lookupErrors++;}
 }
 return {inDb,lookupErrors,gaps,notInInventory};
}
