import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveDate, recent, undatedGuard } from './date-policy.mjs';
const now='2026-11-02T06:00:00Z';
test('exact 72 hours; official dates always win; absence requires verified live page',()=>{
 const row={firstSeenAt:now,publishedAt:null};
 assert(recent(effectiveDate(row,'2026-10-30T06:00:00Z').date,now));
 assert(!recent(effectiveDate(row,'2026-10-30T05:59:59Z').date,now));
 assert(!recent(effectiveDate(row,'invalid',true).date,now));
 assert.equal(effectiveDate(row,null).date,null);
 assert.equal(effectiveDate(row,null,true).label,'게시일 미표기 · 수집일 2026-11-02 기준');
 assert.equal(effectiveDate({...row,publishedAt:'2026-01-01'},null,true).date,'2026-01-01');
 assert(!recent('2026-11-02T06:00:01Z',now));
});
test('bulk undated is held and recovered inventory baselined',()=>{
 const rows=Array.from({length:21},(_,id)=>({id,sourceId:'source',publishedAt:null,firstSeenAt:now}));
 assert(undatedGuard(rows).every(x=>x.action==='hold'));
 assert(undatedGuard(rows,{source:now}).every(x=>x.action==='baseline'));
 assert(undatedGuard(rows.slice(0,20)).every(x=>x.action==='candidate'));
});

test('relative Workday card dates cannot masquerade as exact stored official dates',()=>{
 const row={firstSeenAt:'2026-10-01',publishedAt:now,sourcePostedText:'Posted Today'};
 assert.equal(effectiveDate(row,null,true).date,null);assert.equal(effectiveDate(row,'2026-11-01',true).date,'2026-11-01');
});

test('pending fallback uses the fresh exact firstSeen timestamp, never the date-only label',async()=>{
 const {pendingEffectiveDate}=await import('./date-policy.mjs');
 const r={rationale:'Keyword match (not individually reviewed). 게시일 미표기 · 수집일 2026-11-02 기준'};
 assert.equal(pendingEffectiveDate(r),null);assert.equal(pendingEffectiveDate(r,{firstSeenAt:now}),now);
 assert.equal(pendingEffectiveDate({rationale:'Official date: 2026-10-01.'},{firstSeenAt:now}),'2026-10-01');
});
