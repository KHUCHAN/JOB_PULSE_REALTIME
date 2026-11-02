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
