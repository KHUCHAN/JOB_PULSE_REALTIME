import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {spawnSync} from 'node:child_process';
import {revalidateDispatch,patchDispatchBody,persistedQuarantine,uncoveredCaveats} from './dispatch-policy.mjs';import {evaluateEvidence} from './evidence-policy.mjs';import {keywordLabels} from './keyword-policy.mjs';
const {asOf,rows}=JSON.parse(await fs.readFile(new URL('./undated-fixtures.json',import.meta.url))),row={...rows[0].row,officialUrl:'https://careers.ibm.com/job/fixture'};
const labels=keywordLabels(row,row.description),result=evaluateEvidence({row,health:'healthy',asOf,labels,evidence:{status:202,html:''}}),candidate={jobId:row.id,officialUrl:row.officialUrl,verifiedUrl:row.officialUrl,labels,date:result.date};
const request=async url=>url.includes('resource=sources')?new Response(JSON.stringify([{id:row.sourceId,health:'healthy'}])):new Response('',{status:202});
test('final undated 202 revalidation uses fresh collector and exact caveats',async()=>{assert((await revalidateDispatch(row,candidate,{rationale:result.rationale},null,{request,asOf})).ok);assert(!(await revalidateDispatch({...row,lastConfirmedAt:'2026-10-30'},candidate,{rationale:result.rationale},null,{request,asOf})).ok);});
test('fresh visible date, closed page and new caveat prevent dispatch',async()=>{
 for(const text of ['Posting Date: Unknown','This position has been filled']){const request=async url=>url.includes('resource=sources')?new Response(JSON.stringify([{id:row.sourceId,health:'healthy'}])):new Response(text);assert(!(await revalidateDispatch(row,candidate,{rationale:result.rationale},null,{request,asOf})).ok);}
 const updated={...row,qualifications:'Must have U.S. citizenship.'};assert(!(await revalidateDispatch(updated,candidate,{rationale:result.rationale},null,{request,asOf})).ok);
});
test('archived dispatch transformation removes specific caveats and missing-page gates; syntax remains valid',async()=>{
 const old=await fs.readFile(new URL('../../runtime-root/current-snapshot/.codex_tmp/us-dispatch-20260930.mjs',import.meta.url),'utf8'),patched=patchDispatchBody(old);
 assert(!patched.includes('if(!internshipProgram(j.title,officialBody))'));assert(!patched.includes('Must be enrolled in second year'));assert(!patched.includes('Live official detail unavailable; approval retained'));assert(patched.includes('revalidateDispatch(j,candidate,local,evidence)'));
 const child=spawnSync(process.execPath,['--input-type=module','--check'],{input:patched,encoding:'utf8'});assert.equal(child.status,0,child.stderr);
});

test('read-only dispatch applies stored dated collector evidence, old, relative and empty guards',async()=>{
 const dated={...row,publishedAt:asOf,sourcePostedText:'2026-11-02'};
 const evaluated=evaluateEvidence({row:dated,health:'healthy',asOf,labels,evidence:{status:202,html:''}});assert.equal(evaluated.decision,'approve');
 const c={...candidate,date:asOf},local={rationale:evaluated.rationale};
 assert((await revalidateDispatch(dated,c,local,null,{request,asOf})).ok);
 for(const patch of [{publishedAt:'2026-10-28'},{sourcePostedText:'2 days ago'},{description:'',responsibilities:'',qualifications:''}])assert(!(await revalidateDispatch({...dated,...patch},c,local,null,{request,asOf})).ok);
});

test('404 and 410 hold dispatch; sources infrastructure throws instead of excluding silently',async()=>{
 for(const status of [404,410])await assert.rejects(revalidateDispatch(row,candidate,{rationale:result.rationale},null,{asOf,request:async url=>url.includes('resource=sources')?new Response(JSON.stringify([{id:row.sourceId,health:'healthy'}])):new Response('',{status})}),/hold-official-detail/);
 await assert.rejects(revalidateDispatch(row,candidate,{rationale:result.rationale},null,{asOf,request:async()=>new Response('',{status:503})}),/hold-infrastructure/);
});
test('reconciliation record yields every uncertain identity without unattempted rows',()=>{
 const q=persistedQuarantine({failed:{uncertainIds:['a']},additionalUncertainAttempts:[{jobId:'b',canonicalUrl:'https://x/b',requisitionId:'R1',company:'C',title:'T',location:'L'}],additionalRejectedAttempts:[{jobId:'c'}],unattemptedIds:['z']});
 assert.deepEqual(q.map(x=>x.id),['a','b','c']);assert.equal(q[1].officialUrl,'https://x/b');assert.deepEqual(persistedQuarantine({}),[]);
});
test('a page flattening stored caveats into one run-on passes, but a new restriction still blocks',()=>{
 const rationale='Keyword match (not individually reviewed). United States. Official date: 2026-11-02. Application caveats: What We Need to See: | Pursuing a BS, MS, or PhD in Computer Science. | Relocation:\nNo relocation';
 assert.deepEqual(uncoveredCaveats(['What We Need to See: Pursuing a BS, MS, or PhD in Computer Science. Strong C++ skills. Relocation: No relocation'],rationale),[]);
 assert.deepEqual(uncoveredCaveats(['Pursuing a BS, MS, or PhD in Computer Science.'],rationale),[]);
 const added='What We Need to See: Pursuing a BS, MS, or PhD in Computer Science. U.S. citizens only.';
 assert.deepEqual(uncoveredCaveats([added],rationale),[added]);
 assert.deepEqual(uncoveredCaveats(['Visa sponsorship is not available.'],'Keyword match. No caveats here.'),['Visa sponsorship is not available.']);
 assert.deepEqual(uncoveredCaveats(['Date Posted: 2026-11-02 Country: United States of America'],'x. Application caveats: Must relocate.'),[]);
});
