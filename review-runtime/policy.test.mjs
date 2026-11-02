import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import ts from 'typescript';
import {evaluateEvidence,storedCountry} from './evidence-policy.mjs';import {dateFromOfficial} from './date-policy.mjs';import {extractCaveats} from './caveats.mjs';
const src=await fs.readFile(new URL('../lib/resume-match.ts',import.meta.url),'utf8');
const {normalize,roleEvidence,skillEvidence,domainEvidence}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(src+'\nexport {normalize,roleEvidence,skillEvidence,domainEvidence};',{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const fixtures=JSON.parse(await fs.readFile(new URL('./undated-fixtures.json',import.meta.url)));
for(const {row,health} of fixtures.rows)test('084513 stored evidence '+row.id.slice(0,8),()=>{
 const body=[row.description,row.responsibilities,row.qualifications].filter(Boolean).join(' '),hay=normalize(row.title+' '+body);
 const labels=[roleEvidence(normalize(row.title))??roleEvidence(hay),...skillEvidence({...row,description:body}),domainEvidence(hay)].filter(Boolean).map(x=>x.label);
 const r=evaluateEvidence({row,health,asOf:fixtures.asOf,labels,evidence:{status:row.id.startsWith('379')?202:200,html:'<div id="root"></div>'}});
 assert.equal(r.decision,row.id.startsWith('e28b6383')?'reject':'approve',JSON.stringify(r));if(r.decision==='approve')assert.match(r.rationale,/게시일 미표기 · 수집일/);
});
const base={...fixtures.rows[2],asOf:fixtures.asOf,labels:['AI or machine learning role'],evidence:{status:202,html:''}};
test('missing evidence never writes reject; unhealthy, stale, short, unknown country hold',()=>{
 for(const patch of [{health:'failed'},{row:{...base.row,lastConfirmedAt:'2026-10-30'}},{row:{...base.row,description:'',qualifications:''}},{row:{...base.row,location:'Unknown',locationCountry:null}},{evidence:{status:200,html:'Posted on: November 1st'}}])assert.equal(evaluateEvidence({...base,...patch}).decision,'hold');
 assert.equal(evaluateEvidence({...base,labels:[]}).decision,'reject');assert.equal(evaluateEvidence({...base,labels:[]}).reason,'affirmative no keyword fit on available text');
});
test('readable date wins, visible unparsed and relative hold, old official rejects',()=>{
 assert.equal(evaluateEvidence({...base,officialDate:'2026-10-01'}).reason,'old official date');
 assert.equal(dateFromOfficial(base.row,'2026-11-01',base.evidence,true).basis,'official');
 for(const text of ['Posted Yesterday','datePosted: unknown','Posting Date: Nov 1'])assert.equal(dateFromOfficial(base.row,null,{status:200,text},true).date,null);
 assert.equal(evaluateEvidence({...base,row:{...base.row,publishedAt:fixtures.asOf,sourcePostedText:'Posted Today'}}).decision,'hold');
});
test('US examples and Canadian country override',()=>{
 for(const location of ['San Jose, US','New York, United States of America','US-MA-Stoughton','UNITED STATES-NC-Charlotte','Houston TX'])assert.equal(storedCountry({location}),'United States');
 assert.equal(storedCountry({location:'Markham, CA',locationCountry:'United States'}),'non-US');
});
test('caveats are generic exact source sentences, including coursework and timing',()=>{
 const text='Matriculating students must be in their junior year. Completed an Introduction to Computer Science course. You must attend the office three days per week. No visa sponsorship is available. Must be a U.S. citizen. Security clearance required.';
 const c=extractCaveats(text);assert.equal(c.length,6);for(const s of c)assert(text.includes(s));
});

test('continuity of operations COOP is not a student program',()=>{
 const row={...base.row,title:'COOP Analyst - Continuity of Operations',employmentType:null};
 assert.equal(evaluateEvidence({...base,row}).decision,'hold');
});

test('unreadable dated pages use stored official date and DB text with all guards',()=>{
 const row={...base.row,publishedAt:fixtures.asOf,sourcePostedText:'2026-11-02'};
 const r=evaluateEvidence({...base,row});assert.equal(r.decision,'approve',JSON.stringify(r));assert.equal(r.date,row.publishedAt);assert.equal(r.dateBasis,'stored-official');assert.equal(r.collectorFallback,false);assert(!r.rationale.includes('게시일 미표기'));assert(r.rationale.includes('Official date: '+row.publishedAt));
 const old=evaluateEvidence({...base,row:{...row,publishedAt:'2026-10-28'}});assert.equal(old.decision,'reject');assert.equal(old.reason,'old official date');
 for(const sourcePostedText of ['Posted Today','2 days ago','3 hours ago'])assert.equal(evaluateEvidence({...base,row:{...row,sourcePostedText}}).decision,'hold');
 assert.equal(evaluateEvidence({...base,row:{...row,description:'',responsibilities:'',qualifications:''}}).decision,'hold');
 assert.equal(evaluateEvidence({...base,row,health:'failed'}).decision,'hold');
 assert.equal(evaluateEvidence({...base,row:{...row,lastConfirmedAt:'2026-10-28'}}).decision,'hold');
});
