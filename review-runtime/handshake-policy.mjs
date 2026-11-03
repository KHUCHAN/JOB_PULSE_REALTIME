// Pure selection for Handshake rows read through the connected Chrome. No LLM, network or file access.
import {platformCompanyKey} from '../lib/platform-discovery.ts';
export const HANDSHAKE_QUERIES=['data science intern','machine learning intern','data engineer intern','software engineer intern','data analyst intern','business analyst intern','forward deployed engineer','co-op data'];
const FAMILY=/\bdata\b|machine learning|\bml\b|\bai\b|artificial intelligence|analytics|\banalyst\b|software|forward deployed/i;
const INTERN_TITLE=/\bintern(?:s|ship)?\b|\bco-?op\b/i,INTERN_TYPE=/\binternship\b|\bco-?op\b/i;
const US_LOCATION=/,\s*[A-Z]{2}(?:\s*\+\s*\d+)?$|\bremote\b|\bunited states\b/i;
export const isPriorityIntern=title=>INTERN_TITLE.test(title)&&FAMILY.test(title);
export const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,'');
export function parseCard({id,lines}){
 // A label such as "USC collection" can sit between the type line and the location, so read the location back from the separator.
 const [company,title,meta]=lines,dot=lines.indexOf('∙'),location=dot>0?lines[dot-1]:lines[3],displayDate=lines.at(-1);
 return {id,company,title,meta,location,displayDate,platformUrl:'https://usc.joinhandshake.com/job-search/'+id};
}
const recent=d=>d==='New'||(/^(\d+)d ago$/.exec(d)?.[1]??9)<=3;
export function selectLeads(rows){
 const seen=new Map();
 for(const row of rows){const c=parseCard(row);const key=platformCompanyKey(c.company??'')+'|'+norm(c.title);if(c.company&&c.title&&!seen.has(key))seen.set(key,c);}
 return [...seen.values()].filter(c=>(INTERN_TITLE.test(c.title)||INTERN_TYPE.test(c.meta??''))&&FAMILY.test(c.title)&&US_LOCATION.test(c.location??'')&&recent(c.displayDate));
}
export function splitByInventory(leads,sources){
 const known=new Set(sources.map(s=>platformCompanyKey(s.company)));
 return {inInventory:leads.filter(l=>known.has(platformCompanyKey(l.company))),notInInventory:leads.filter(l=>!known.has(platformCompanyKey(l.company)))};
}
// Durable list of employers seen on Handshake but missing from the source catalog; entries leave once added.
export function updateSourceGaps(ledger,rows,day,sources){
 const known=new Set(sources.map(s=>platformCompanyKey(s.company))),next={};
 for(const [key,entry] of Object.entries(ledger??{}))if(!known.has(key))next[key]=entry;
 for(const {company,title,platformUrl} of rows){
  const key=platformCompanyKey(company),entry=next[key]??{company,firstSeen:day,lastSeen:null,days:0,titles:[],platformUrl};
  if(entry.lastSeen!==day){entry.lastSeen=day;entry.days++;}
  if(!entry.titles.includes(title)&&entry.titles.length<3)entry.titles.push(title);
  next[key]=entry;
 }
 return next;
}
export function mergeLeads(data,report,limit=20,{name='Handshake',via='through the connected Chrome',evidenceUrl='https://usc.joinhandshake.com/job-search'}={}){
 const platforms=(data.platforms??[]).filter(p=>p.name!==name);
 platforms.push({name,status:report.status,reason:report.reason??`Read ${report.unique??0} rows ${via}; ${report.gaps?.length??0} missing from the DB.`,evidenceUrl});
 const candidates=[...(data.candidates??[])],have=new Set(candidates.map(c=>platformCompanyKey(c.company)+'|'+norm(c.title)));
 for(const g of report.gaps??[]){const key=platformCompanyKey(g.company)+'|'+norm(g.title);if(candidates.length>=limit)break;if(have.has(key))continue;have.add(key);candidates.push({company:g.company,title:g.title,location:g.location,platform:name,platformUrl:g.platformUrl,displayDate:g.displayDate,officialUrl:''});}
 return {...data,platforms,candidates};
}
