import { classifyJobRegion } from './job-region-classifier.ts';
import type { CrawledJob, CrawlSource } from './crawler.ts';
export type PlatformCandidate = { company:string; title:string; location:string; platform:string; platformUrl:string; displayDate:string; officialUrl:string; sourceId?:string };
// Employers that platforms name differently from the source catalog, keyed by normalized name.
const PLATFORM_COMPANY_ALIASES:Record<string,string>={statefarminsurancecompanies:'statefarm',siemensdigitalindustriessoftware:'siemensusdigitalindustries'};
export const platformCompanyKey=(s:string)=>{const key=s.toLowerCase().replace(/\b(?:incorporated|inc|corporation|corp|llc)\b/g,'').replace(/[^a-z0-9]+/g,'');return PLATFORM_COMPANY_ALIASES[key]??key;};
export function platformSource(candidate:PlatformCandidate,sources:CrawlSource[]):CrawlSource|null {
  const matches=sources.filter(s=>platformCompanyKey(s.company)===platformCompanyKey(candidate.company));
  let url:URL;try{url=new URL(candidate.officialUrl);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password)return null;
  const matching=matches.filter(s=>{const host=new URL(s.postingUrl).hostname.replace(/^www\./,'');return url.hostname.replace(/^www\./,'')===host||url.hostname.endsWith('.'+host);});
  return matching.length===1?matching[0]:null;
}
export function officialPlatformJob(candidate:PlatformCandidate,source:CrawlSource,html:string):CrawledJob|null {
  if(platformSource(candidate,[source])?.id!==source.id)return null;
  if(/<title[^>]*>\s*(?:Just a moment|Radware)|captcha challenge|cf-chl-/i.test(html))return null;
  const posts:Record<string,any>[]=[];
  const walk=(x:any):void=>{if(Array.isArray(x))x.forEach(walk);else if(x&&typeof x==='object'){if(x['@type']==='JobPosting')posts.push(x);if(x['@graph'])walk(x['@graph']);}};
  for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walk(JSON.parse(m[1]));}catch{}}
  const key=(s:unknown)=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,'');
  const matches=posts.filter(p=>key(p.title)===key(candidate.title));if(matches.length!==1)return null;
  const p=matches[0],locations=Array.isArray(p.jobLocation)?p.jobLocation:[p.jobLocation];
  const addresses=locations.map((x:any)=>x?.address).filter(Boolean);
  if(!addresses.some((a:any)=>classifyJobRegion({locationCountry:typeof a.addressCountry==='string'?a.addressCountry:a.addressCountry?.name,locationCity:a.addressLocality,locationState:a.addressRegion})==='us'))return null;
  const desc=String(p.description??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  if(desc.length<80||!(/\bintern(?:s|ship|ships)?\b|\bco[ -]?op\b/i.test(p.title+' '+desc)))return null;
  const officialDate=p.datePosted??p.dateModified;
  // Platform display dates are deliberately never used as official evidence.
  if(officialDate&&!Number.isFinite(Date.parse(officialDate)))return null;
  const id=typeof p.identifier==='string'?p.identifier:p.identifier?.value;
  return {externalId:id?String(id):candidate.officialUrl,requisitionId:id?String(id):null,title:p.title,company:source.company,location:addresses.map((a:any)=>[a.addressLocality,a.addressRegion,typeof a.addressCountry==='string'?a.addressCountry:a.addressCountry?.name].filter(Boolean).join(', ')).join('; '),locationCountry:'United States',arrangement:'unknown',employmentType:null,summary:desc.slice(0,500),description:desc,publishedAt:officialDate?new Date(officialDate).toISOString():null,officialUrl:candidate.officialUrl};
}
