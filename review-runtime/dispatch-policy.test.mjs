import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {spawnSync} from 'node:child_process';
import {revalidateDispatch,patchDispatchBody} from './dispatch-policy.mjs';import {evaluateEvidence} from './evidence-policy.mjs';import {keywordLabels} from './keyword-policy.mjs';
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
 assert(!patched.includes('Must be enrolled in second year'));assert(!patched.includes('Live official detail unavailable; approval retained'));assert(patched.includes('revalidateDispatch(j,candidate,local,evidence)'));
 const child=spawnSync(process.execPath,['--input-type=module','--check'],{input:patched,encoding:'utf8'});assert.equal(child.status,0,child.stderr);
});
