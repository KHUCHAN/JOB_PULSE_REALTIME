import './evidence-io.cjs';
import {acquireReviewLock} from './lane-lock.mjs';
import {compressEvidence} from './disk-evidence.mjs';
// Server-side reads only. Local state and attempt resolutions are atomic.
import fs from 'node:fs/promises';import path from 'node:path';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),{atomic}=require('./atomic-state.cjs'),config=require('./live-config.cjs');
const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export async function attempts(runtime){const found=[];for(const dir of await fs.readdir(path.join(runtime,'live-runs')).catch(()=>[]))for(const name of await fs.readdir(path.join(runtime,'live-runs',dir)))if(name.startsWith('post-attempt-')){const file=path.join(runtime,'live-runs',dir,name);found.push({file,...JSON.parse(await fs.readFile(file))});}return found;}
export async function reconcile({root=path.join(config.base,'runtime-root'),runtime=path.join(config.base,'review-runtime'),request=fetch,finish=false}={}){
 const file=path.join(root,'.codex_tmp/codex-direct-db-gmail-state.json'),state=JSON.parse(await fs.readFile(file));let unresolved=0,resolved=0;
 for(const a of await attempts(runtime)){
  if(a.status==='completed')continue;
  const rows=[];let proven=true;
  for(const id of a.ids){const response=await request(config.endpoint+'/api/pulse?resource=job&id='+encodeURIComponent(id),{signal:AbortSignal.timeout(20000)});if(!response.ok){proven=false;break;}const j=await response.json(),old=a.identities.find(x=>x.id===id);
   if(!old||j.id!==id||j.officialUrl!==old.officialUrl||norm(j.company)!==norm(old.company)||norm(j.title)!==norm(old.title)||norm(j.location)!==norm(old.location)||norm(j.requisitionId)!==norm(old.requisitionId)){proven=false;break;}
   if(a.action==='submitCodexReview'){const r=a.payload.reviews.find(r=>r.jobId===id);if(j.resumeReviewDecision!==r.decision){proven=false;break;}}
   else if(!j.resumeNotifiedAt&&!j.resumeIdentityAlreadyNotified){proven=false;break;}
   rows.push(j);
  }
  if(!proven){unresolved++;continue;}
  for(const j of rows){let local=Object.values(state.records).find(r=>r.jobId===j.id);
   if(!local){const r=a.payload.reviews?.find(r=>r.jobId===j.id);if(!r){proven=false;break;}
    const key=r.requisitionId?'req:'+norm(r.requisitionId):'url:'+r.officialUrl.replace(/\/$/,'');if(state.records[key])throw Error('Reconcile identity collision');
    local=state.records[key]={jobId:j.id,requisitionId:r.requisitionId,canonicalOfficialUrl:r.officialUrl,fingerprint:[j.company,j.title,j.location].map(norm).join('|'),company:j.company,title:j.title,location:j.location,decision:r.decision,rationale:r.rationale,persistedAt:a.at,sentAt:null,identityAlreadyNotified:false};
   }
   if(j.resumeNotifiedAt||j.resumeIdentityAlreadyNotified){local.sentAt=j.resumeNotifiedAt??a.at;local.identityAlreadyNotified=true;}
  }
  if(!proven){unresolved++;continue;}
  atomic(file,JSON.stringify(state),{state:true});
  atomic(a.file,JSON.stringify({...a,file:undefined,status:'completed',resolvedAt:new Date().toISOString(),resolution:'server GET exact identity and durable review/delivery'}));resolved++;if(finish)await compressEvidence(path.dirname(a.file));
 }
 if(!unresolved&&finish){atomic(path.join(root,'live-inflight.json'),JSON.stringify({status:'completed',resolvedAt:new Date().toISOString()}));
  // Retain the hold as evidence. Startup and rollback accept only a resolved hold.
  const h=path.join(root,'live-hold.json');try{atomic(h,JSON.stringify({...JSON.parse(await fs.readFile(h)),resolved:true}));}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 return {resolved,unresolved,serverWrites:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){await acquireReviewLock();const r=await reconcile({finish:true});console.log(JSON.stringify(r));if(r.unresolved)process.exitCode=1;}
