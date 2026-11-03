import {test} from 'node:test';import assert from 'node:assert/strict';import {comparePolicy,legacySelectionAgrees} from './comparison-policy.mjs';import {YEAR_LABEL} from './evidence-policy.mjs';
const old={jobId:'id',decision:'approve',rationale:'Keyword match (not individually reviewed). United States. Direct software engineering role. Official date: 2026-11-01. Application caveats: Must be enrolled. | No sponsorship.'};
const args={legacy:[old],fresh:[{...old,rationale:old.rationale.replace('Must be enrolled. | No sponsorship.','No sponsorship. | Must be enrolled. | Must attend onsite.')}],rows:[{id:'id',publishedAt:'2026-11-01'}],audit:[{id:'id',caveats:['No sponsorship.','Must be enrolled.','Must attend onsite.'],caveatsVerbatim:true}],legacySelected:['id'],freshSelected:['id'],keywordLabels:['Direct software engineering role']};
test('only a row approved on the 2027 label alone is explained by the user rule',()=>{
 const year={id:'id',decision:'approve',labels:[YEAR_LABEL],caveats:[],caveatsVerbatim:true},fresh=[{...old,rationale:'Keyword match (not individually reviewed). United States. '+YEAR_LABEL+'. Official date: 2026-11-01.'}];
 const input={...args,legacy:[{...old,decision:'reject',rationale:'Rejected'}],fresh,audit:[year],legacySelected:[],freshSelected:['id'],reviewedExceptions:[]};
 const result=comparePolicy(input);assert(result.accepted,JSON.stringify(result.blockers));assert.equal(result.explainedUndatedDifferences[0].reason,'User rule: a 2027 internship or co-op needs no keyword');
 for(const labels of [['Direct software engineering role'],[YEAR_LABEL,'Direct software engineering role'],[]])assert(!comparePolicy({...input,audit:[{...year,labels}]}).accepted,String(labels));
 assert(!comparePolicy({...input,audit:[{...year,decision:'hold'}]}).accepted);
 assert(!comparePolicy({...input,freshSelected:['id','other']}).accepted);
});
test('reviewed exceptions require exact heartbeat, id, type and legacy text',()=>{
 const entry={heartbeat:'heartbeat-20261102T175217',id:'id',type:'missing caveat',legacyValue:'Must be enrolled.',reason:'Supervisor reviewed descriptive prose'};
 const input={...args,heartbeat:entry.heartbeat,fresh:[{...old,rationale:old.rationale.replace('Must be enrolled. | ','')}],reviewedExceptions:[entry]};
 const result=comparePolicy(input);assert(result.accepted);assert.equal(result.reviewedExceptions.length,1);assert.equal(result.unusedExceptions.length,0);
 for(const patch of [{id:'other'},{legacyValue:'Must be enrolled!'},{heartbeat:'heartbeat-20261102T145302'},{type:'decision'}]){const r=comparePolicy({...input,reviewedExceptions:[{...entry,...patch}]});assert(!r.accepted);assert.equal(r.reviewedExceptions.length,0);assert.equal(r.unusedExceptions.length,1);}
 assert(!comparePolicy({...input,fresh:[{...input.fresh[0],rationale:input.fresh[0].rationale.replace('No sponsorship.','')}]}).accepted);
});
test('reviewed hold to approve explains only its associated selection change',()=>{
 const entry={heartbeat:'heartbeat-20261102T175217',id:'id',type:'decision',legacyValue:'hold',freshValue:'approve',reason:'Supervisor reviewed guard mismatch'};
 const input={...args,heartbeat:entry.heartbeat,legacy:[],legacySelected:[],reviewedExceptions:[entry]};
 const result=comparePolicy(input);assert(result.accepted);assert.equal(result.reviewedExceptions.length,1);
 assert(!comparePolicy({...input,fresh:[{...old,decision:'reject'}]}).accepted);
 assert(!comparePolicy({...input,freshSelected:['id','other']}).accepted);
});
test('major list presentation preserves all values; fused benefits exception requires majors',()=>{
 const legacyValue='PREFERRED MAJORS: Finance; Accounting',source='PREFERRED MAJORS:\nFinance \nAccounting';
 const legacy=[{...old,rationale:old.rationale.split('Application caveats:')[0]+'Application caveats: '+legacyValue}],fresh=[{...legacy[0],rationale:legacy[0].rationale.replace(legacyValue,source)}];
 const input={...args,legacy,fresh,audit:[{id:'id',caveats:[source],caveatsVerbatim:true}]};assert(comparePolicy(input).accepted);
 assert(!comparePolicy({...input,fresh:[{...fresh[0],rationale:fresh[0].rationale.replace('Accounting','Economics')}],audit:[{id:'id',caveats:[source.replace('Accounting','Economics')],caveatsVerbatim:true}]}).accepted);
 const fused=legacyValue+'; OUR BENEFITS:; Free travel',entry={heartbeat:'heartbeat-20261102T175217',id:'id',type:'missing caveat',legacyValue:fused,requiredFreshCaveat:legacyValue,reason:'Supervisor reviewed fused benefits'};
 const f={...input,heartbeat:entry.heartbeat,legacy:[{...legacy[0],rationale:legacy[0].rationale.replace(legacyValue,fused)}],reviewedExceptions:[entry]};assert(comparePolicy(f).accepted);
 assert(!comparePolicy({...f,fresh:[{...fresh[0],rationale:fresh[0].rationale.replace('Accounting','')}]}).accepted);
});
test('sentence ordering and extra verbatim caveats accepted',()=>{const a=comparePolicy(args);assert(a.accepted,JSON.stringify(a));assert.deepEqual(a.caveats[0].extra,['Must attend onsite.']);});
test('missing caveat, date or keyword changes, and selected differences block',()=>{
 for(const patch of [{fresh:[{...old,rationale:old.rationale.replace('Must be enrolled.','')}]},{fresh:[{...old,rationale:old.rationale.replace('2026-11-01','2026-11-02')}]},{fresh:[{...old,rationale:old.rationale.replace('Direct software engineering role','')}]},{freshSelected:[]}])assert(!comparePolicy({...args,...patch}).accepted);
});
test('only observed undated failure is explained; no manual acceptance flag',()=>{
 const legacy=[{jobId:'id',decision:'reject',rationale:'Rejected: required evidence failed (live, location, date)'}],fresh=[{...old}],audit=[{id:'id',dateBasis:'firstSeenAt',collectorFallback:true}];
 assert(comparePolicy({...args,legacy,fresh,audit,rows:[{id:'id',publishedAt:null}],legacySelected:[]}).accepted);
 assert(!comparePolicy({...args,legacy,fresh,audit,rows:[{id:'id',publishedAt:'2026-11-01'}],legacySelected:[]}).accepted);
});

test('missing-text reject to hold is explained only by observed text audit and legacy failed checks',()=>{
 const legacy=[{jobId:'id',decision:'reject',rationale:'Rejected: required evidence failed (live, location, program, fit)'}];
 const audit=[{id:'id',decision:'hold',reason:'posting text unavailable or too short to judge',textLength:0}];
 const input={...args,legacy,fresh:[],audit,legacySelected:[],freshSelected:[]};
 for(const textLength of [0,42,159]){const a=comparePolicy({...input,audit:[{...audit[0],textLength}]});assert(a.accepted);assert.equal(a.explainedMissingEvidenceDifferences[0].id,'id');}
 for(const patch of [{audit:[{...audit[0],textLength:160}]},{audit:[{...audit[0],textLength:undefined}]},{audit:[{...audit[0],reason:'required evidence undecidable: live'}]},{legacy:[{...legacy[0],rationale:'Rejected: no keyword fit'}]}])assert(!comparePolicy({...input,...patch}).accepted);
 // A hand-written acceptance flag cannot change the derived decision.
 assert(!comparePolicy({...input,audit:[{...audit[0],textLength:200}],accepted:true,blockers:[]}).accepted);
});
test('keyword label exception needs exact heartbeat, id and both label sets',()=>{
 const a={jobId:'id',decision:'approve',rationale:'Keyword match (not individually reviewed). United States. Direct software engineering role · AML domain. Official date: 2026-11-01.'},b={...a,rationale:a.rationale.replace(' · AML domain','')};
 const input={legacy:[a],fresh:[b],rows:[{id:'id',publishedAt:'2026-11-01'}],audit:[{id:'id',caveats:[],caveatsVerbatim:true}],legacySelected:['id'],freshSelected:['id'],keywordLabels:['Direct software engineering role','AML domain'],heartbeat:'h'};
 const entry={heartbeat:'h',id:'id',type:'keyword labels',legacyValue:JSON.stringify(['Direct software engineering role','AML domain']),freshValue:JSON.stringify(['Direct software engineering role']),reason:'reviewed'};
 assert(!comparePolicy(input).accepted);
 assert(comparePolicy({...input,reviewedExceptions:[entry]}).accepted);
 for(const patch of [{heartbeat:'other'},{id:'other'},{freshValue:'[]'},{legacyValue:'[]'},{reason:''}])assert(!comparePolicy({...input,reviewedExceptions:[{...entry,...patch}]}).accepted);
 assert(!comparePolicy({...input,fresh:[{...b,rationale:b.rationale.replace('2026-11-01','2026-11-02')}],reviewedExceptions:[entry]}).accepted);
});
test('legacy selection may differ only by IDs the run explains',()=>{
 const dispatch={selected:['a','c'],excluded:[{id:'x'}]},summary={uncertainPersistenceIds:['u']};
 assert(legacySelectionAgrees(['a','u','x','c'],dispatch,summary));assert(legacySelectionAgrees(['a'],null,null));
 assert(legacySelectionAgrees(['a','r','c'],{selected:['a','c']},{rejectedPersistenceIds:['r']}));
 assert(!legacySelectionAgrees(['a','z','c'],dispatch,summary));assert(!legacySelectionAgrees(['c','a'],dispatch,summary));assert(!legacySelectionAgrees(['a','u','c'],{selected:['a','c']},null));
});
test('stored official date label compares by date value',()=>{
 const stored=old.rationale.replace('Official date: 2026-11-01','Stored official date: 2026-11-01');assert.notEqual(stored,old.rationale);
 assert.equal(comparePolicy({...args,legacy:[{...old,rationale:stored}],fresh:[old]}).labels[0].dateMatch,true);
});
test('a legacy approval the fresh lane holds needs its decision reviewed but has no mailed caveats to verify',()=>{
 const legacy=[{jobId:'s',decision:'approve',rationale:'x. Official date: 2026-11-02. Application caveats: Needs clearance.'}],fresh=[{jobId:'s',decision:'hold',rationale:null}],audit=[{id:'s',decision:'hold',reason:'exact caveats exceed 2000-character rationale limit'}];
 const base={legacy,fresh,rows:[],audit,legacySelected:[],freshSelected:[],keywordLabels:[],heartbeat:'h'};
 assert(!comparePolicy(base).accepted);
 const reviewed=[{heartbeat:'h',id:'s',type:'decision',legacyValue:'approve',freshValue:'hold',reason:'r'},{heartbeat:'h',id:'s',type:'missing caveat',legacyValue:'Needs clearance.',reason:'r'}];
 assert(comparePolicy({...base,reviewedExceptions:reviewed}).accepted);
});
