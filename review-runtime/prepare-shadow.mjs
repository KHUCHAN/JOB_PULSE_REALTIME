import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const [project,runtime,stamp]=process.argv.slice(2),root=pathToFileURL(project+'/.codex_tmp/');
let code=await fs.readFile(new URL('heartbeat-20260910T073856-prepare.mjs',root),'utf8');
code=code.replaceAll("from './strict-official-recency.mjs'","from '"+new URL('strict-official-recency.mjs',root).href+"'")
 .replaceAll("from './greenhouse-official-evidence.mjs'","from '"+new URL('greenhouse-official-evidence.mjs',root).href+"'")
 .replaceAll("new URL('./worktrees/repair-all-20260831/","new URL('"+new URL('worktrees/repair-all-20260831/',root).href)
 .replace("const base=new URL('./',import.meta.url)","const base=new URL('"+root.href+"')")
 .replace('microdata(e)??(g?','e?.apiDerivedPosting??microdata(e)??(g?')
 .replace('if(rationale.length>2000)','if(rationale.length>10000)')
 .replace('(!!g||[j.officialUrl,j.applyUrl]','(!!g||!!e?.verifiedCanonicalRedirect||[j.officialUrl,j.applyUrl]')
 .replace("verifiedUrl:decision==='approve'&&!g?e.url:j.officialUrl","verifiedUrl:decision==='approve'&&!g&&!e?.verifiedCanonicalRedirect?e.url:j.officialUrl");
// Keep the archived identity exclusions; replace its evidence/rejection logic.
const evaluator=new URL('./evidence-policy.mjs',import.meta.url).href;
code="import {evaluateEvidence} from '"+evaluator+"';\n"+code;
code=code.replace("const prepared={reviews:","let sourceRows;try{sourceRows=await JSON.parse(await fs.readFile(process.env.JOB_PULSE_SHADOW_OUTPUT+'/source-health.json'));}catch{sourceRows=Object.entries(JSON.parse(await fs.readFile(process.env.JOB_PULSE_SHADOW_OUTPUT+'/undated-source-observations.json')).sources).map(([id,s])=>({id,...s}));}sourceRows=sourceRows.sources??sourceRows;const prepared={reviews:");
const start=code.indexOf(' const title=w?.title'),end=code.indexOf('\n}\nassertRecentApprovals',start);
if(start<0||end<0)throw Error('Archived prepare structure changed');
code=code.slice(0,start)+`
 const title=w?.title??e?.apiDerivedPosting?.title??ld?.title??j.title,body=plain(w?.jobDescription??e?.apiDerivedPosting?.description??ld?.description??''),stored=[j.description,j.responsibilities,j.qualifications].filter(Boolean).join(' ');
 const keywordInput={...j,description:body||stored,skills:j.skills??[]},keywordHaystack=keywordNormalize([j.title,body||stored,j.summary,j.responsibilities,j.jobFamily,j.jobFunction].filter(Boolean).join(' '));
 const labels=[...new Set([roleEvidence(keywordNormalize(j.title))??roleEvidence(keywordHaystack),...skillEvidence(keywordInput),domainEvidence(keywordHaystack)].filter(Boolean).map(x=>x.label))];
 const evaluation=evaluateEvidence({row:j,evidence:e,officialDate:w?.startDate??e?.apiDerivedPosting?.datePosted??ld?.datePosted??ld?.dateModified,officialCountry:country(w?.country)??country(ld?.jobLocation)??officialAddressCountry(ld?.jobLocation)??country(ld?.applicantLocationRequirements),officialBody:body,title,live:e?.status===200&&!!ld&&(!w||w.canApply!==false)&&(!!g||!!e?.verifiedCanonicalRedirect||[j.officialUrl,j.applyUrl].filter(Boolean).some(u=>canon(e.url)===canon(u))),health:sourceRows.find(s=>s.id===j.sourceId)?.health,asOf:scan.runAt,labels});
 prepared.audit.push({id:j.id,title:j.title,...evaluation,...(evaluation.decision==='hold'?{error:evaluation.reason}:{})});
 if(evaluation.decision==='hold')continue;
 const rationale=evaluation.rationale??['Keyword match (not individually reviewed)',labels.join(' · '),'Rejected: '+evaluation.reason].filter(Boolean).join('. ');
 prepared.reviews.push({jobId:j.id,decision:evaluation.decision,rationale,officialUrl:j.officialUrl,verifiedUrl:j.officialUrl,requisitionId:req});
`+code.slice(end);
process.env.JOB_PULSE_RUN_STAMP=stamp;
await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
