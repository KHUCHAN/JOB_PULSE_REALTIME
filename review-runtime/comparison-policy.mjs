import {storedCaveats} from './caveats.mjs';
import {YEAR_LABEL} from './evidence-policy.mjs';
const key=r=>r?.rationale??'';
const date=r=>key(r).match(/게시일 미표기 · 수집일 \d{4}-\d\d-\d\d 기준|(?:Stored official|Official) date: [^. ]+(?:\.\d+Z)?/)?.[0]?.replace(/^Stored official/,'Official')??null;
// Legacy rendered major lists with semicolons. Compare the same ordered values
// against verbatim multiline source blocks; no value may be added or removed.
const majorList=t=>{const m=t.match(/^(PREFERRED MAJORS?:)\s*([\s\S]+)$/);return m?[m[1],...m[2].split(/[;\n]/).map(x=>x.trim()).filter(Boolean)]:null;};
const containsCaveat=(r,caveats,text)=>key(r).includes(text)||!!majorList(text)&&caveats.some(c=>key(r).includes(c)&&JSON.stringify(majorList(c))===JSON.stringify(majorList(text)));
// A run may lose planned approvals after POST; only IDs the run itself explains may leave the dispatch.
export const legacySelectionAgrees=(selected,dispatch,summary)=>{if(!dispatch)return true;const explained=new Set([...(dispatch.excluded??[]).map(x=>x.id),...(summary?.uncertainPersistenceIds??[]),...(summary?.rejectedPersistenceIds??[])]);return JSON.stringify(selected.filter(id=>!explained.has(id)))===JSON.stringify(dispatch.selected);};
export function comparePolicy({legacy,fresh,rows,audit,legacySelected,freshSelected,keywordLabels,heartbeat,reviewedExceptions:entries=[]}) {
 const old=new Map(legacy.map(r=>[r.jobId,r])),next=new Map(fresh.map(r=>[r.jobId,r])),explained=[],missingEvidence=[],unexplained=[],caveats=[],labels=[];
 const used=new Set(),reviewedExceptions=[];
 const reviewed=(id,type,value,allowed)=>{
  const index=entries.findIndex(e=>e.heartbeat===heartbeat&&e.id===id&&e.type===type&&e.legacyValue===value&&typeof e.reason==='string'&&e.reason.length>0&&allowed(e));
  if(index<0)return false;used.add(index);reviewedExceptions.push(entries[index]);return true;
 };
 for(const id of new Set([...old.keys(),...next.keys()])){
  const a=old.get(id),b=next.get(id),j=rows.find(x=>x.id===id),e=audit.find(x=>x.id===id);
  const changed=a?.decision!==b?.decision;
  // Derived only from actual legacy failure, undated DB row and fresh audit.
  const legacyFailed=key(a).match(/required evidence failed\s*\(([^)]+)\)/)?.[1].split(',').map(s=>s.trim())??[];
  const missing=changed&&a?.decision==='reject'&&(!b||b.decision==='hold')&&e?.decision==='hold'&&e.reason==='posting text unavailable or too short to judge'&&Number.isInteger(e.textLength)&&e.textLength>=0&&e.textLength<160&&legacyFailed.some(k=>['live','location','date','program','fit'].includes(k));
  const correction=changed&&b?.decision==='approve'&&a?.decision==='reject'&&!j?.publishedAt&&/required evidence failed/.test(key(a))&&/(?:live|location|date)/.test(key(a).split('required evidence failed')[1]??'')&&e&&(e.dateBasis==='firstSeenAt'||e.collectorFallback===true);
  // The user's rule: only a row approved on the 2027 label alone, which legacy never applied.
  const yearRule=changed&&b?.decision==='approve'&&e?.decision==='approve'&&e.labels?.length===1&&e.labels[0]===YEAR_LABEL;
  if(changed)(missing?missingEvidence:correction||yearRule?explained:unexplained).push({id,legacy:a?.decision??'hold',fresh:b?.decision??'hold',reason:missing?'legacy rejected on missing evidence, fresh holds because the text cannot be judged':yearRule?'User rule: a 2027 internship or co-op needs no keyword':correction?'POLICY undated collector evidence':e?.reason??'unexplained gate difference',audit:e});
  if(a?.decision==='approve'){
   const legacyC=storedCaveats(key(a)),freshC=e?.caveats??[],missing=legacyC.filter(s=>!containsCaveat(b,freshC,s)),extra=freshC.filter(s=>!legacyC.some(t=>t.includes(s)||!!majorList(t)&&JSON.stringify(majorList(t))===JSON.stringify(majorList(s))));
   caveats.push({id,missing,extra,extrasVerbatim:b?.decision!=='approve'||e?.caveatsVerbatim===true});
  }
  if(!correction&&a?.decision==='approve'&&b?.decision==='approve'){
   const before=keywordLabels.filter(l=>key(a).includes(l)),after=keywordLabels.filter(l=>key(b).includes(l));
   labels.push({id,legacy:before,fresh:after,keywordMatch:JSON.stringify(before)===JSON.stringify(after),dateMatch:date(a)===date(b),legacyDate:date(a),freshDate:date(b)});
  }
 }
 const remainingDecisions=unexplained.filter(x=>!reviewed(x.id,'decision',x.legacy,e=>e.freshValue===x.fresh));
 for(const c of caveats)c.unreviewedMissing=c.missing.filter(text=>!reviewed(c.id,'missing caveat',text,e=>!e.requiredFreshCaveat||containsCaveat(next.get(c.id),audit.find(x=>x.id===c.id)?.caveats??[],e.requiredFreshCaveat)));
 const reviewedSelections=reviewedExceptions.filter(e=>e.type==='decision'&&e.legacyValue==='hold'&&e.freshValue==='approve'&&!legacySelected.includes(e.id)&&freshSelected.includes(e.id));
 const excluded=new Set([...explained,...missingEvidence,...reviewedSelections].map(x=>x.id)),selectedDifference=[...new Set([...legacySelected,...freshSelected])].filter(id=>!excluded.has(id)&&legacySelected.includes(id)!==freshSelected.includes(id));
 const blockers=[...remainingDecisions.map(x=>'decision '+x.id),...selectedDifference.map(id=>'selection '+id),...caveats.filter(x=>x.unreviewedMissing.length||!x.extrasVerbatim).map(x=>'caveats '+x.id),...labels.filter(x=>!x.dateMatch||!x.keywordMatch&&!reviewed(x.id,'keyword labels',JSON.stringify(x.legacy),e=>e.freshValue===JSON.stringify(x.fresh))).map(x=>'labels '+x.id)];
 return {accepted:!blockers.length,explainedUndatedDifferences:explained,explainedMissingEvidenceDifferences:missingEvidence,unexplainedDecisionDifferences:remainingDecisions,selectedDifference,caveats,labels,blockers,reviewedExceptions,unusedExceptions:entries.filter((_,i)=>!used.has(i))};
}
