import {test} from 'node:test';import assert from 'node:assert/strict';import {comparePolicy} from './comparison-policy.mjs';
const old={jobId:'id',decision:'approve',rationale:'Keyword match (not individually reviewed). United States. Direct software engineering role. Official date: 2026-11-01. Application caveats: Must be enrolled. | No sponsorship.'};
const args={legacy:[old],fresh:[{...old,rationale:old.rationale.replace('Must be enrolled. | No sponsorship.','No sponsorship. | Must be enrolled. | Must attend onsite.')}],rows:[{id:'id',publishedAt:'2026-11-01'}],audit:[{id:'id',caveats:['No sponsorship.','Must be enrolled.','Must attend onsite.'],caveatsVerbatim:true}],legacySelected:['id'],freshSelected:['id'],keywordLabels:['Direct software engineering role']};
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
