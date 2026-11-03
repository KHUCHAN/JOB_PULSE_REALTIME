import {keywordLabels} from './keyword-policy.mjs';
// Final read-only revalidation shared by fresh and pending approvals.
import fs from 'node:fs/promises';import path from 'node:path';import {JSDOM} from 'jsdom';import {evaluateEvidence,storedCountry} from './evidence-policy.mjs';import {postingText,sentences,protectedCaveat} from './caveats.mjs';
const canon=s=>{const u=new URL(s);u.hash='';for(const k of [...u.searchParams.keys()])if(/^(utm_|source$|src$|ref$|gh_src$|_ccid$)/i.test(k))u.searchParams.delete(k);return u.href.replace(/\/$/,'');};
const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const flatten=x=>Array.isArray(x)?x.flatMap(flatten):x&&typeof x==='object'?[x,...flatten(x['@graph']??[])]:[];
// Identities from the durable reconciliation record; these POSTs are never repeated.
export const persistedQuarantine=record=>[...(record.failed?.uncertainIds??[]).map(id=>({id})),...[...(record.additionalUncertainAttempts??[]),...(record.additionalRejectedAttempts??[])].map(x=>({id:x.jobId,officialUrl:x.canonicalUrl,requisitionId:x.requisitionId,company:x.company,title:x.title,location:x.location}))];
export const readPersistedQuarantine=runtime=>fs.readFile(path.join(runtime,'PENDING_PERSISTENCE_RECONCILIATION.json'),'utf8').then(x=>persistedQuarantine(JSON.parse(x)),e=>{if(e.code==='ENOENT')return [];throw e;});
// Official pages may flatten the review text into one run-on, so compare content rather than line breaks.
// Only a restriction left over after removing every stored caveat blocks an immutable approval.
const looseCaveat=s=>new RegExp((s.match(/[\p{L}\p{N}]+/gu)??[]).map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[^\\p{L}\\p{N}]+'),'giu');
export function uncoveredCaveats(caveats,rationale){
 const stored=(rationale.split('Application caveats:')[1]??'').split(' | ').map(s=>s.trim()).filter(s=>/[\p{L}\p{N}]/u.test(s)).sort((a,b)=>b.length-a.length);
 return caveats.filter(caveat=>!rationale.includes(caveat)&&sentences(stored.reduce((rest,s)=>rest.replace(looseCaveat(s),' '),caveat)).some(protectedCaveat));
}
export async function revalidateDispatch(row,candidate,local,saved,{request=fetch,asOf=new Date().toISOString()}={}) {
 if(local?.title&&norm(local.title)!==norm(row.title)||local?.company&&norm(local.company)!==norm(row.company)||local?.location&&norm(local.location)!==norm(row.location)||candidate.requisitionId&&norm(candidate.requisitionId)!==norm(row.requisitionId))return {ok:false,reason:'fresh durable identity changed'};
 if(norm(row.title)!==norm(candidate.title??row.title)||candidate.officialUrl&&canon(candidate.officialUrl)!==canon(row.officialUrl))return {ok:false,reason:'fresh identity changed'};
 const sr=await request('https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse?resource=sources');if(!sr.ok)throw Error('hold-infrastructure: fresh source health unavailable');
 const health=(await sr.json()).find(s=>s.id===row.sourceId)?.health;
 let page,html='';try{page=await request(candidate.verifiedUrl??row.officialUrl,{signal:AbortSignal.timeout(20000)});html=await page.text();}catch{/* An unreadable official page uses the fresh collector evidence. */}
 if(page?.status===404||page?.status===410)throw Error('hold-official-detail: '+page.status);
 if(!page||![200,202,403,429].includes(page.status))throw Error('hold-infrastructure: official page unavailable');
 if(page?.url&&canon(page.url)!==canon(candidate.verifiedUrl??row.officialUrl))return {ok:false,reason:'canonical official URL changed'};
 if(/job (?:is no longer|not found)|position (?:has been filled|is no longer available)/i.test(postingText(html)))return {ok:false,reason:'official posting closed'};
 const doc=new JSDOM(html).window.document,lds=[];
 for(const script of doc.querySelectorAll('script[type="application/ld+json"]'))try{lds.push(...flatten(JSON.parse(script.textContent)));}catch{}
 const postings=lds.filter(x=>x['@type']==='JobPosting');if(postings.length>1)return {ok:false,reason:'ambiguous official identity'};
 const micro=k=>{const el=doc.querySelector('[itemprop="'+k+'"]');return el?.getAttribute('content')??el?.textContent?.trim();};
 const parsed=postings[0]??(micro('title')?{title:micro('title'),datePosted:micro('datePosted'),description:micro('description'),jobLocation:{address:{addressCountry:micro('addressCountry')}}}:null);
 if(parsed?.title&&norm(parsed.title)!==norm(row.title))return {ok:false,reason:'readable official title changed'};
 // Existing specialized API checks still execute after this check, before POST.
 const api=saved?.officialTimestampProof||saved?.ats?.url&&/boards-api\.greenhouse\.io|api\.smartrecruiters\.com|\/hcmRestApi\//.test(saved.ats.url);
 const posting=parsed??(api?saved?.apiDerivedPosting:null);
 const country=/United States|"US"|"USA"/i.test(JSON.stringify(posting?.jobLocation??posting?.applicantLocationRequirements??''))?'United States':null;
 const evaluation=evaluateEvidence({row,evidence:{status:page?.status,html},officialDate:posting?.datePosted??posting?.dateModified,officialCountry:country,officialBody:posting?.description,title:posting?.title,live:!!posting&&page?.status===200,health,asOf,labels:keywordLabels(row,postingText(posting?.description??[row.description,row.responsibilities,row.qualifications].filter(Boolean).join(' ')))});
 if(evaluation.decision!=='approve')return {ok:false,reason:'final evidence hold: '+evaluation.reason};
 if(candidate.date&&Date.parse(candidate.date)!==Date.parse(evaluation.date))return {ok:false,reason:'effective date changed'};
 if(uncoveredCaveats(evaluation.caveats,local.rationale).length)return {ok:false,reason:'fresh exact caveat missing from immutable rationale'};
 return {ok:true,date:evaluation.date,country:storedCountry(row),collectorFallback:evaluation.collectorFallback};
}
export function patchDispatchBody(code){
 code=code.replace('required.some(x=>!mail.recipients.includes(x))','mail.recipients.length!==required.length||new Set(mail.recipients).size!==required.length||required.some(x=>!mail.recipients.includes(x))');
 const required=(s)=>{if(!code.includes(s))throw Error('Archived dispatch structure changed: '+s);};
 const caveatStart=code.includes('let authHtml=')?'let authHtml=':'const enrollmentCaveat=';required(caveatStart);
 const start=code.indexOf(caveatStart),end=code.indexOf('const identity=j.requisitionId?',start);if(end<0)throw Error('Archived identity marker missing');
 code=code.slice(0,start)+`const policyCheck=await revalidateDispatch(j,candidate,local,evidence);if(!policyCheck.ok){excluded.push({id:j.id,reason:policyCheck.reason});continue;}\n `+code.slice(end);
 // Replace the old unreadable-page exclusion with the complete generic check
 // above. Vendor API identity/date checks immediately before this stay intact.
 const a=code.indexOf('let live,html;try{live=await fetch(candidate.verifiedUrl'),b=code.indexOf('identities.add(identity);identities.add(fp(j));selected.push',a);
 if(a<0||b<0)throw Error('Archived live recheck markers missing');code=code.slice(0,a)+code.slice(b);
 code=code.replace(/from 'file:[^']*\/date-policy\.mjs'/,"from '"+new URL('./date-policy.mjs',import.meta.url).href+"'");
 return "import {revalidateDispatch} from '"+import.meta.url+"';\n"+code;
}
