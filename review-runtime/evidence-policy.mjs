import {dateFromOfficial,recent} from './date-policy.mjs';
import {postingText,extractCaveats} from './caveats.mjs';
const states='AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
export function storedCountry(row) {
 const t=String(row.location??'');
 // A Canadian city plus country CA must override a faulty collector country.
 if(/\b(?:Markham|Toronto|Ottawa|Vancouver|Montreal|Waterloo|Mississauga|Calgary|Edmonton)\b.*(?:,\s*CA\b|Canada)/i.test(t)||/\bCanada\b/i.test(t))return 'non-US';
 if(/United States(?: of America)?|\bUSA\b|(?:^|[,;\s])US(?:$|[-,;\s])/i.test(t)||new RegExp('\\b(?:'+states+')(?:$|\\s+\\d{5}\\b)').test(t))return 'United States';
 if(/\b(?:United Kingdom|Singapore|India|Germany|China|Japan|Australia|Ireland|France|Mexico)\b|,\s*(?:GB|UK|SG|IN|DE|CN|JP|AU|IE|FR|MX)$/i.test(t))return 'non-US';
 return /^(?:US|USA|United States(?: of America)?)$/i.test(row.locationCountry??'')?'United States':null;
}
export function collectorReady(row,health,asOf) {
 const age=Date.parse(asOf)-Date.parse(row.lastConfirmedAt);
 return health==='healthy'&&Number.isFinite(age)&&age>=0&&age<=24*3600000;
}
export function evaluateEvidence({row,evidence,officialDate,officialCountry,officialBody,title,live,health,asOf,labels}) {
 const stored=postingText([row.description,row.responsibilities,row.qualifications].filter(Boolean).join('\n'));
 const fallback=!row.publishedAt&&!officialDate&&collectorReady(row,health,asOf);
 const body=postingText(officialBody)|| (fallback?stored:'');
 const d=dateFromOfficial(row,officialDate,evidence,fallback);
 const country=storedCountry(row)==='non-US'?'non-US':officialCountry??(fallback?storedCountry(row):null);
 const programText=(title||row.title)+' '+(fallback?(row.employmentType??''):body);
 const program=!( /continuity\s+of\s+operations/i.test(programText)&&!/\bintern(?:s|ships?)?\b|\bco[ -]op\b/i.test(programText))&&/\bintern(?:s|ships?)?\b|\bco[ -]?op\b/i.test(programText);
 const checks={live:!!live||fallback,location:country==='United States',program,date:recent(d.date,asOf),fit:labels.length>0};
 const failed=Object.keys(checks).filter(k=>!checks[k]);
 const hold=reason=>({decision:'hold',reason,date:d.date,dateBasis:d.basis,country,checks,failed,labels,collectorFallback:fallback});
 if(health!=='healthy')return hold('source unhealthy or unverified');
 if(!live&&!collectorReady(row,health,asOf))return hold('collector evidence stale or unverified');
 if(/^(?:closed|expired|removed|inactive)$/i.test(row.status??''))return {...hold('closed posting'),decision:'reject'};
 if(country==='non-US')return {...hold('affirmative non-US location'),decision:'reject'};
 if(!d.date||!Number.isFinite(Date.parse(d.date)))return hold('official date missing, relative or visibly unparsed');
 if(Date.parse(d.date)>Date.parse(asOf))return hold('future date');
 if(!checks.date)return {...hold(d.basis==='firstSeenAt'?'collection older than 72h':'old official date'),decision:d.basis==='firstSeenAt'?'hold':'reject'};
 if(body.length<160)return hold('posting text unavailable or too short to judge');
 if(!program&&live&&body.length>=160)return {...hold('affirmative non-internship program'),decision:'reject'};
 if(!labels.length)return {...hold('affirmative no keyword fit on available text'),decision:'reject'};
 if(failed.length)return hold('required evidence undecidable: '+failed.join(', '));
 const caveats=extractCaveats(body),coop=/co[ -]?op/i.test(row.title+' '+row.employmentType);
 const rationale=['Keyword match (not individually reviewed)',country,labels.join(' · '),coop?'timing not stated; verify semester overlap':'',d.label??`Official date: ${d.date}`,caveats.length?'Application caveats: '+caveats.join(' | '):''].filter(Boolean).join('. ');
 if(rationale.length>2000)return hold('exact caveats exceed 2000-character rationale limit');
 return {...hold(null),decision:'approve',failed:[],rationale,caveats,caveatsVerbatim:caveats.every(s=>body.includes(s))};
}
