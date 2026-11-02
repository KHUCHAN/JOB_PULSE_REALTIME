import {storedCaveats} from './caveats.mjs';
const key=r=>r?.rationale??'';
const date=r=>key(r).match(/게시일 미표기 · 수집일 \d{4}-\d\d-\d\d 기준|Official date: [^. ]+(?:\.\d+Z)?/)?.[0]??null;
export function comparePolicy({legacy,fresh,rows,audit,legacySelected,freshSelected,keywordLabels}) {
 const old=new Map(legacy.map(r=>[r.jobId,r])),next=new Map(fresh.map(r=>[r.jobId,r])),explained=[],unexplained=[],caveats=[],labels=[];
 for(const id of new Set([...old.keys(),...next.keys()])){
  const a=old.get(id),b=next.get(id),j=rows.find(x=>x.id===id),e=audit.find(x=>x.id===id);
  const changed=a?.decision!==b?.decision;
  // Derived only from actual legacy failure, undated DB row and fresh audit.
  const correction=changed&&a?.decision==='reject'&&!j?.publishedAt&&/required evidence failed/.test(key(a))&&/(?:live|location|date)/.test(key(a).split('required evidence failed')[1]??'')&&e&&(e.dateBasis==='firstSeenAt'||e.collectorFallback===true);
  if(changed)(correction?explained:unexplained).push({id,legacy:a?.decision??'hold',fresh:b?.decision??'hold',reason:correction?'POLICY undated collector evidence':e?.reason??'unexplained gate difference',audit:e});
  if(a?.decision==='approve'){
   const legacyC=storedCaveats(key(a)),freshC=e?.caveats??[],missing=legacyC.filter(s=>!key(b).includes(s)),extra=freshC.filter(s=>!legacyC.some(t=>t.includes(s)));
   caveats.push({id,missing,extra,extrasVerbatim:e?.caveatsVerbatim===true});
  }
  if(!correction&&a?.decision==='approve'&&b?.decision==='approve'){
   const before=keywordLabels.filter(l=>key(a).includes(l)),after=keywordLabels.filter(l=>key(b).includes(l));
   labels.push({id,legacy:before,fresh:after,keywordMatch:JSON.stringify(before)===JSON.stringify(after),dateMatch:date(a)===date(b),legacyDate:date(a),freshDate:date(b)});
  }
 }
 const excluded=new Set(explained.map(x=>x.id)),selectedDifference=[...new Set([...legacySelected,...freshSelected])].filter(id=>!excluded.has(id)&&legacySelected.includes(id)!==freshSelected.includes(id));
 const blockers=[...unexplained.map(x=>'decision '+x.id),...selectedDifference.map(id=>'selection '+id),...caveats.filter(x=>x.missing.length||!x.extrasVerbatim).map(x=>'caveats '+x.id),...labels.filter(x=>!x.keywordMatch||!x.dateMatch).map(x=>'labels '+x.id)];
 return {accepted:!blockers.length,explainedUndatedDifferences:explained,unexplainedDecisionDifferences:unexplained,selectedDifference,caveats,labels,blockers};
}
