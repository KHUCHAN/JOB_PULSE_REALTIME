import fs from 'node:fs/promises';
import path from 'node:path';
import { undatedGuard } from './date-policy.mjs';
export async function guardScan(scan, sources, runtime) {
  const file=path.join(runtime,'undated-source-observations.json');
  let previous;
  try { previous=JSON.parse(await fs.readFile(file,'utf8')); }
  catch(error) { if(error.code!=='ENOENT')throw error; previous={sources:{},epochs:{}}; }
  const epochs={...previous.epochs};
  for(const source of sources){
    const old=previous.sources[source.id];
    if(old && (old.postingUrl!==source.postingUrl || (old.health!=='healthy' && source.health==='healthy')))
      epochs[source.id]=scan.runAt;
    if(!old && Object.keys(previous.sources).length)epochs[source.id]=scan.runAt;
    if(!['healthy','empty','inactive'].includes(source.health))epochs[source.id]=scan.runAt;
  }
  const decisions=undatedGuard(scan.details.map(x=>x.row),epochs);
  scan.datePolicyGuard={decisions:decisions.filter(x=>x.action!=='candidate'),asOf:scan.runAt};
  const excluded=new Set(scan.datePolicyGuard.decisions.map(x=>x.id));
  scan.details=scan.details.filter(x=>!excluded.has(x.row.id));
  await fs.writeFile(file,JSON.stringify({observedAt:scan.runAt,epochs,sources:Object.fromEntries(sources.map(s=>[s.id,{health:s.health,postingUrl:s.postingUrl}]))},null,2));
  return scan;
}
