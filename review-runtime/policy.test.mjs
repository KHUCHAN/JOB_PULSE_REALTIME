import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import ts from 'typescript';
import {evaluateEvidence,storedCountry} from './evidence-policy.mjs';import {dateFromOfficial} from './date-policy.mjs';import {extractCaveats,sentences} from './caveats.mjs';
import {keywordLabels} from './keyword-policy.mjs';
test('fit ignores recruiting warnings and employer AI, retaining real duties and education',()=>{
 const row={title:'Engineering Intern',summary:'Fraud and AI',responsibilities:'Fraud',skills:['Python'],jobFamily:'AI',jobFunction:'fraud'};
 for(const body of ['Build mechanical fixtures.\nFraudulent Recruiting Disclaimer: Beware of internet job posting fraud.','Test equipment.\nCompany Overview\nWe equip all employees with AI tools.','Test equipment.\nAI and Biometric Usage\nWe use AI to prevent identity fraud.'])assert.deepEqual(keywordLabels(row,body),[]);
 assert(keywordLabels(row,'Currently pursuing a degree in data analytics.').includes('Analytics tooling'));
 assert(keywordLabels({title:'Intern'},'Analyze fraud patterns with Python.').includes('Risk or fraud analytics role'));
 const text='Visa sponsorship unavailable.\nCandidate AI Usage Policy\nWe use AI during recruiting.';keywordLabels(row,text);assert(extractCaveats(text).includes('Visa sponsorship unavailable.'));
});
test('preferred majors are a protected verbatim block stopping before the next heading',()=>{
 const text='PREFERRED MAJORS:\nBusiness Administration \nComputer Science\nOUR BENEFITS TO INTERNS (subject to being onsite):\nAccess to on-site fitness center';
 assert.deepEqual(extractCaveats(text),['PREFERRED MAJORS:\nBusiness Administration \nComputer Science']);
 assert.deepEqual(extractCaveats('PREFERRED MAJOR: Finance; Accounting'),['PREFERRED MAJOR: Finance; Accounting']);
});
test('bullets, amenities and duties do not create conditions; restrictions survive',()=>{
 const noise=['· Strong analytical skills','· Proficient in Microsoft Office Suite','Café and dining options on-site','Access to on-site fitness center','Create and present reports to senior leadership.','Analyze inventory to improve material availability.'];
 const required=['· Degree required for on-site projects.','Visa sponsorship is unavailable.','Must be a U.S. citizen.','Clearance is required.','Must attend onsite three days per week.'];
 assert.deepEqual(extractCaveats([...noise,...required].join('\n')),required);
});
const src=await fs.readFile(new URL('../lib/resume-match.ts',import.meta.url),'utf8');
const {normalize,roleEvidence,skillEvidence,domainEvidence}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(src+'\nexport {normalize,roleEvidence,skillEvidence,domainEvidence};',{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const fixtures=JSON.parse(await fs.readFile(new URL('./undated-fixtures.json',import.meta.url)));
for(const {row,health} of fixtures.rows)test('084513 stored evidence '+row.id.slice(0,8),()=>{
 const body=[row.description,row.responsibilities,row.qualifications].filter(Boolean).join(' '),hay=normalize(row.title+' '+body);
 const labels=[roleEvidence(normalize(row.title))??roleEvidence(hay),...skillEvidence({...row,description:body}),domainEvidence(hay)].filter(Boolean).map(x=>x.label);
 const r=evaluateEvidence({row,health,asOf:fixtures.asOf,labels,evidence:{status:row.id.startsWith('379')?202:200,html:'<div id="root"></div>'}});
 assert.equal(r.decision,row.id.startsWith('e28b6383')?'hold':'approve',JSON.stringify(r));if(r.decision==='approve')assert.match(r.rationale,/게시일 미표기 · 수집일/);
});
const base={...fixtures.rows[2],asOf:fixtures.asOf,labels:['AI or machine learning role'],evidence:{status:202,html:''}};
test('abbreviations preserve source whitespace and never merge across lines',()=>{
 const text='Must be authorized to work in the U.S.\nPreferred\nA U.S.  citizen needs a Ph.\tD. degree.';
 assert.deepEqual(sentences(text),['Must be authorized to work in the U.S.','Preferred','A U.S.  citizen needs a Ph.\tD. degree.']);
 for(const c of extractCaveats(text))assert(text.includes(c));
});
test('headings, benefits, equal opportunity boilerplate and hashtags are not conditions',()=>{
 const text=['Required','Preferred qualifications:','Free stand-by travel privileges for employees','Travel benefits begin on day one','Up to six employee choice travel credits','Our interns also receive unlimited standby travel benefits during their internship.','(3) Ensure that all personnel actions and sponsored programs are administered without regard to race or national origin.','#LI-Hybrid'].join('\n');
 assert.deepEqual(extractCaveats(text),[]);
});
test('filters retain every education and legal restriction even with boilerplate words',()=>{
 const required=['A degree is required to receive travel benefits.','Enrollment is required for hybrid benefits.','Visa holders must apply separately.','No sponsorship is available; equal opportunity employer.','Must be authorized to work in the U.S.','Citizenship required for this travel role.','Security clearance required; privacy rules apply.','Must graduate next year.'];
 assert.deepEqual(extractCaveats(required.join('\n')),required);
});
test('rationale budget drops optional conditions last first and retains exact restrictions',()=>{
 const required='A bachelor degree and enrollment are required. No visa sponsorship is available. Citizenship and security clearance are required.';
 const optional=Array.from({length:24},(_,i)=>`Must attend the office ${i+1} days for ${'scheduled activities '.repeat(5)}.`);
 const r=evaluateEvidence({...base,live:true,officialBody:[required,...optional].join('\n')});
 assert.equal(r.decision,'approve',JSON.stringify(r));assert(r.rationale.length<=2000);assert.equal(r.caveatsVerbatim,true);
 for(const c of extractCaveats(required))assert(r.caveats.includes(c));
 const retained=r.caveats.filter(c=>optional.includes(c));assert(retained.length>0&&retained.length<optional.length);assert.deepEqual(retained,optional.slice(0,retained.length));
});
test('protected caveats alone exceeding the budget hold without truncation',()=>{
 const r=evaluateEvidence({...base,live:true,officialBody:'A degree in '+('a subject '.repeat(210))+'is required.'});
 assert.equal(r.decision,'hold');assert.match(r.reason,/2000-character/);
});
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
 assert.equal(storedCountry({location:'Markham, CA',locationCountry:'United States'}),null);
});
test('caveats are generic exact source sentences, including coursework and timing',()=>{
 const text='Matriculating students must be in their junior year. Completed an Introduction to Computer Science course. You must attend the office three days per week. No visa sponsorship is available. Must be a U.S. citizen. Security clearance required.';
 const c=extractCaveats(text);assert.equal(c.length,6);for(const s of c)assert(text.includes(s));
});

test('continuity of operations COOP is not a student program',()=>{
 const row={...base.row,title:'COOP Analyst - Continuity of Operations',employmentType:null,description:'Maintain continuity of operations emergency response plans. '.repeat(5),responsibilities:null,qualifications:null};
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

test('undated readable body supplies internship program and exact region classifier handles country collisions',()=>{
 const row={...base.row,title:'Data Science Student',employmentType:null,location:'Los Alamos, New Mexico',locationCountry:null};
 const r=evaluateEvidence({...base,row,live:true,evidence:{status:200,html:'<p>'+('This internship supports data science and modeling projects. '.repeat(6))+'</p>'}});assert.equal(r.decision,'approve',JSON.stringify(r));
 assert.equal(storedCountry({location:'Los Alamos, New Mexico'}),'United States');assert.equal(storedCountry({location:'Bengaluru, IN'}),'non-US');
 assert.equal(evaluateEvidence({...base,row:{...base.row,location:'Bengaluru, IN',locationCountry:null}}).decision,'reject');
 for(const status of [undefined,404,410,500])assert.equal(evaluateEvidence({...base,evidence:{status,html:''}}).decision,'hold');
});
test('crawler employment type is not program evidence when the official page is readable',()=>{
 const body='Analyze transactions and build financial models for corporate clients. '.repeat(4);
 const row={...base.row,title:'2027 Investment Banking Summer Associate',employmentType:'Internship / Full-time'};
 const r=evaluateEvidence({...base,row,title:row.title,live:true,officialBody:body,officialDate:fixtures.asOf,officialCountry:'United States',evidence:{status:200,html:''}});
 assert.equal(r.decision,'reject');assert.match(r.reason,/non-internship/);
});

test('bare country/state collisions hold without affirmative country evidence',()=>{
 for(const location of ['Hyderabad, IN','Pune, IN','Unknown City, CO','Unknown City, AR','Unknown City, IL','Unknown City, PA','Unknown City IN','Unknown City, CA','Unknown City, DE','Unknown City, ID','Unknown City, MA','Unknown City, ME','Unknown City, MD','Unknown City, MS','Unknown City, MT']){
  const row={...base.row,location,locationCountry:null,locationState:null,locationRegion:'us'};
  assert.equal(storedCountry(row),null,location);const r=evaluateEvidence({...base,row});assert.equal(r.decision,'hold',location);assert.equal(r.reason,'ambiguous work location',location);
  assert.equal(evaluateEvidence({...base,row,officialCountry:'United States'}).decision,'approve',location);
 }
 for(const location of ['Ontario, CA','Mexico, MO','Indianapolis, IN','Denver, CO','Little Rock, AR','Chicago, IL','Philadelphia, PA','Nashville TN'])assert.equal(storedCountry({location}),'United States',location);
 assert.equal(storedCountry({location:'Pune, IN',locationCountry:'India'}),'non-US');
 assert.equal(storedCountry({location:'Unknown City, IN',locationState:'IN'}),null);
});
test('authorization wording survives filtering and equal-opportunity text is dropped',()=>{
 const legal='Legal authorization to work in the United States, now and in the future.';
 assert(extractCaveats(legal).includes(legal));
 assert.deepEqual(extractCaveats('All qualified applicants will receive consideration for employment without regard to national origin or citizenship.'),[]);
 assert.deepEqual(sentences('Tasks include drafting reports Must be currently enrolled at a university Must have a Minimum GPA of 3.0'),['Tasks include drafting reports','Must be currently enrolled at a university','Must have a Minimum GPA of 3.0']);
});
test('titles about an intern program hold instead of counting as internships',()=>{
 const body='An official posting that describes the responsibilities of this position. '.repeat(4);
 for(const title of ['Confluent - Software Developer - Intern Conversion','Business Program Manager, Global Intern Experience & Innovation']){const r=evaluateEvidence({...base,live:true,title,officialBody:body});assert.equal(r.decision,'hold');assert.match(r.reason,/intern program or conversion/);}
 assert.notEqual(evaluateEvidence({...base,live:true,title:'Intern Experience Analyst Internship',officialBody:body}).reason,'title concerns an intern program or conversion, not an internship');
});
