import {dateFromOfficial,recent} from './date-policy.mjs';
import {postingText,extractCaveats,caveatClass,protectedCaveat} from './caveats.mjs';
import {classifyJobRegion} from '../lib/job-region-classifier.ts';
// Bare postal codes also used as foreign country codes need independent proof.
const countryStateCodes=new Set('AL AR AZ CA CO DE GA ID IL IN KY LA MA MD ME MN MO MS MT NC NE PA SC SD TN VA'.split(' '));
const knownUsCities={TN:['Nashville','Memphis','Knoxville'],CA:['Ontario','San Jose','San Francisco','Los Angeles','San Diego','Sacramento'],MO:['Mexico','St Louis','Kansas City'],IN:['Indianapolis','Bloomington','West Lafayette'],CO:['Denver','Boulder','Colorado Springs'],AR:['Little Rock','Bentonville','Fayetteville'],IL:['Chicago','Urbana','Champaign'],PA:['Philadelphia','Pittsburgh','State College'],DE:['Wilmington','Newark','Dover']};
const normalizeCity=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function storedRegion(row){
 let ambiguous=false;
 const location=value=>{
  if(typeof value!=='string')return value;
  const match=value.trim().match(/^(?:(.+?)(?:,\s*|\s+))?([A-Z]{2})$/);
  if(!match||!countryStateCodes.has(match[2]))return value;
  if(knownUsCities[match[2]]?.some(city=>normalizeCity(city)===normalizeCity(match[1]??'')))return 'United States';
  // Keep affirmative foreign locality evidence already recognized by the classifier.
  if(match[2]!=='DE'&&classifyJobRegion({location:value})==='non_us')return value;
  ambiguous=true;return null;
 };
 const primary=location(row.location),secondary=(row.secondaryLocations??[]).map(location);
 const region=classifyJobRegion({...row,location:primary,secondaryLocations:secondary,...(ambiguous?{sourcePostingUrl:null,locationState:countryStateCodes.has(row.locationState?.trim().toUpperCase())?null:row.locationState}:{})});
 return ambiguous&&region==='unknown'?'ambiguous':region;
}
export function storedCountry(row) {
 const region=storedRegion(row);return region==='us'?'United States':region==='non_us'?'non-US':null;
}
export function collectorReady(row,health,asOf) {
 const age=Date.parse(asOf)-Date.parse(row.lastConfirmedAt);
 return health==='healthy'&&Number.isFinite(age)&&age>=0&&age<=24*3600000;
}
export function evaluateEvidence({row,evidence,officialDate,officialCountry,officialBody,title,live,health,asOf,labels}) {
 const stored=postingText([row.description,row.responsibilities,row.qualifications].filter(Boolean).join('\n'));
 const collectorEvidence=!officialDate&&(!live||!row.publishedAt)&&collectorReady(row,health,asOf);
 const fallback=collectorEvidence&&!row.publishedAt;
 const body=postingText(officialBody)|| (evidence?.status===200?postingText(evidence.html):'') || (collectorEvidence?stored:'');
 const d=dateFromOfficial(row,officialDate,evidence,fallback);
 const country=storedCountry(row)==='non-US'?'non-US':officialCountry??(collectorEvidence?storedCountry(row):null);
 const programText=(title||row.title)+' '+body;
 const program=!( /continuity\s+of\s+operations/i.test(programText)&&!/\bintern(?:s|ships?)?\b|\bco[ -]op\b/i.test(programText))&&/\bintern(?:s|ships?)?\b|\bco[ -]?op\b/i.test(programText);
 const checks={live:!!live||collectorEvidence,location:country==='United States',program,date:recent(d.date,asOf),fit:labels.length>0};
 const failed=Object.keys(checks).filter(k=>!checks[k]);
 const hold=reason=>({decision:'hold',reason,date:d.date,dateBasis:d.basis,country,checks,failed,labels,collectorFallback:fallback,collectorEvidence,textLength:body.length});
 if(evidence?.status===404||evidence?.status===410)return hold('official detail missing (404/410)');
 if(!live&&![200,202,403,429].includes(evidence?.status))return hold('official status unavailable');
 if(health!=='healthy')return hold('source unhealthy or unverified');
 if(!live&&!collectorReady(row,health,asOf))return hold('collector evidence stale or unverified');
 if(/^(?:closed|expired|removed|inactive)$/i.test(row.status??''))return {...hold('closed posting'),decision:'reject'};
 if(storedRegion(row)==='mixed'||(storedRegion(row)==='ambiguous'&&!country))return hold('ambiguous work location');
 if(country==='non-US')return {...hold('affirmative non-US location'),decision:'reject'};
 if(!d.date||!Number.isFinite(Date.parse(d.date)))return hold('official date missing, relative or visibly unparsed');
 if(Date.parse(d.date)>Date.parse(asOf))return hold('future date');
 if(!checks.date)return {...hold(d.basis==='firstSeenAt'?'collection older than 72h':'old official date'),decision:d.basis==='firstSeenAt'?'hold':'reject'};
 if(body.length<160)return hold('posting text unavailable or too short to judge');
 if(!program&&live&&body.length>=160)return {...hold('affirmative non-internship program'),decision:'reject'};
 if(!labels.length)return {...hold('affirmative no keyword fit on available text'),decision:'reject'};
 if(failed.length)return hold('required evidence undecidable: '+failed.join(', '));
 const caveats=extractCaveats(body),coop=/co[ -]?op/i.test(row.title+' '+row.employmentType);
 const buildRationale=()=>['Keyword match (not individually reviewed)',country,labels.join(' · '),coop?'timing not stated; verify semester overlap':'',d.label??`Official date: ${d.date}`,caveats.length?'Application caveats: '+caveats.join(' | '):''].filter(Boolean).join('. ');
 let rationale=buildRationale();
 for(let i=caveats.length-1;i>=0&&rationale.length>2000;i--){
  if(!protectedCaveat(caveats[i])&&['attendance','attendance/timing','study timing','prerequisite','application prerequisite'].includes(caveatClass(caveats[i]))){caveats.splice(i,1);rationale=buildRationale();}
 }
 if(rationale.length>2000)return hold('exact caveats exceed 2000-character rationale limit');
 return {...hold(null),decision:'approve',failed:[],rationale,caveats,caveatsVerbatim:caveats.every(s=>body.includes(s))};
}
