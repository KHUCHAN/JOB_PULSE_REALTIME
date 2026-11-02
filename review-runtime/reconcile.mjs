import './evidence-io.cjs';
import {acquireReviewLock} from './lane-lock.mjs';
import {compressEvidence} from './disk-evidence.mjs';
// Server-side reads only. Local state and attempt resolutions are atomic.
import fs from 'node:fs/promises';import path from 'node:path';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),{atomic}=require('./atomic-state.cjs'),config=require('./live-config.cjs');
const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export async function attempts(runtime){const found=[];for(const dir of await fs.readdir(path.join(runtime,'live-runs')).catch(()=>[]))for(const name of await fs.readdir(path.join(runtime,'live-runs',dir)))if(name.startsWith('post-attempt-')){const file=path.join(runtime,'live-runs',dir,name);found.push({file,...JSON.parse(await fs.readFile(file))});}return found;}
async function recordNonDurable(runtime,attempt,items){
 const file=path.join(runtime,'PENDING_PERSISTENCE_RECONCILIATION.json');
 const record=await fs.readFile(file,'utf8').then(JSON.parse,e=>{if(e.code==='ENOENT')return {};throw e;});
 const known=new Set((record.additionalUncertainAttempts??[]).map(x=>x.jobId));
 const added=items.filter(x=>!known.has(x.row.id)).map(({row,review})=>({jobId:row.id,requisitionId:row.requisitionId??null,company:row.company,title:row.title,location:row.location,canonicalUrl:row.officialUrl,expectedDecision:review.decision,receiptStatus:attempt.httpStatus,receiptAt:attempt.at,serverDecisionAfterReadOnlyRecheck:null,serverNotifiedAt:null,localRecordWritten:false,reason:'accepted_but_review_not_durable',noRetry:true,excludeFromDispatchAndFutureReviews:true,noStateSubstitution:true}));
 atomic(file,JSON.stringify({...record,additionalUncertainAttempts:[...(record.additionalUncertainAttempts??[]),...added]},null,2));
}
export async function reconcile({root=path.join(config.base,'runtime-root'),runtime=path.join(config.base,'review-runtime'),request=fetch,finish=false}={}){
 const file=path.join(root,'.codex_tmp/codex-direct-db-gmail-state.json'),state=JSON.parse(await fs.readFile(file));let unresolved=0,resolved=0;
 for(const a of await attempts(runtime)){
  if(a.status==='completed')continue;
  const rows=[],nonDurable=[];let proven=true;
  for(const id of a.ids){const response=await request(config.endpoint+'/api/pulse?resource=job&id='+encodeURIComponent(id),{signal:AbortSignal.timeout(20000)});if(!response.ok){proven=false;break;}const j=await response.json(),old=a.identities.find(x=>x.id===id);
   if(!old||j.id!==id||j.officialUrl!==old.officialUrl||norm(j.company)!==norm(old.company)||norm(j.title)!==norm(old.title)||norm(j.location)!==norm(old.location)||norm(j.requisitionId)!==norm(old.requisitionId)){proven=false;break;}
   if(a.action==='submitCodexReview'){const r=a.payload.reviews.find(r=>r.jobId===id);if(j.resumeReviewDecision!==r.decision){
    // HTTP 200 yet nothing stored: quarantine for good, no retry and no local record.
    if(a.httpStatus===200&&j.resumeReviewDecision==null&&!j.resumeNotifiedAt){nonDurable.push({row:j,review:r});continue;}
    proven=false;break;}}
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
  if(nonDurable.length)await recordNonDurable(runtime,a,nonDurable);
  atomic(a.file,JSON.stringify({...a,file:undefined,status:'completed',resolvedAt:new Date().toISOString(),resolution:'server GET exact identity and durable review/delivery',nonDurableIds:nonDurable.map(x=>x.row.id)}));resolved++;if(finish)await compressEvidence(path.dirname(a.file));
 }
 if(!unresolved&&finish){atomic(path.join(root,'live-inflight.json'),JSON.stringify({status:'completed',resolvedAt:new Date().toISOString()}));
  // Retain the hold as evidence. Startup and rollback accept only a resolved hold.
  const h=path.join(root,'live-hold.json');try{atomic(h,JSON.stringify({...JSON.parse(await fs.readFile(h)),resolved:true}));}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 return {resolved,unresolved,serverWrites:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){await acquireReviewLock();const r=await reconcile({finish:true});console.log(JSON.stringify(r));if(r.unresolved)process.exitCode=1;}
