// Pure rules for the daily platform stage. No LLM, network or file access.
import {platformCompanyKey} from '../lib/platform-discovery.ts';
import {norm,isPriorityIntern} from './handshake-policy.mjs';
const text=s=>String(s??'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
export function parseLinkedinCards(html){
 const rows=[];
 for(const card of String(html).split(/(?=<(?:div|a)[^>]*class="[^"]*base-card[ "])/).slice(1)){
  const company=text(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/.exec(card)?.[1]),title=text(/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/.exec(card)?.[1]);
  const location=text(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/.exec(card)?.[1]),displayDate=/<time[^>]*datetime="([^"]+)"/.exec(card)?.[1]??'';
  const platformUrl=/href="(https:\/\/[^"?]*linkedin\.com\/jobs\/view\/[^"?]+)/.exec(card)?.[1]??'';
  if(company&&title&&platformUrl)rows.push({company,title,location,displayDate,platformUrl});
 }
 return rows;
}
// Off because three measured Codex runs (269K, 150K and 64K input tokens) added no row to the queue.
export const URL_SEARCH_ENABLED=false;
export const urlSearchKey=c=>platformCompanyKey(c.company)+'|'+norm(c.title);
export function selectLinkedinLeads(rows){
 const seen=new Map();for(const row of rows)if(isPriorityIntern(row.title)&&!seen.has(urlSearchKey(row)))seen.set(urlSearchKey(row),row);
 return [...seen.values()];
}
// A row searched once is not searched again, and a row whose employer has no source could never pass reconcile.
export function pendingUrlSearches(candidates,tried,sources,limit=4){
 const hosts=new Map();
 for(const s of sources){const key=platformCompanyKey(s.company);try{if(!hosts.has(key))hosts.set(key,new Set());hosts.get(key).add(new URL(s.postingUrl).hostname.replace(/^www\./,''));}catch{}}
 return candidates.filter(c=>!c.officialUrl&&hosts.has(platformCompanyKey(c.company))&&!tried?.[urlSearchKey(c)]).slice(0,limit).map((c,id)=>({id,company:c.company,title:c.title,location:c.location,sourceHosts:[...hosts.get(platformCompanyKey(c.company))]}));
}
export function applyFound(candidates,pending,found){
 const byId=new Map(pending.map(p=>[p.id,urlSearchKey(p)]));let applied=0;
 const urls=new Map();for(const f of found??[]){if(byId.has(f.id)&&/^https:\/\//.test(f.officialUrl??''))urls.set(byId.get(f.id),f.officialUrl);}
 for(const c of candidates)if(!c.officialUrl&&urls.has(urlSearchKey(c))){c.officialUrl=urls.get(urlSearchKey(c));applied++;}
 return applied;
}
export function markTried(tried,pending,day,keepDays=14){
 const oldest=new Date(Date.parse(day)-keepDays*86400000).toISOString().slice(0,10),next={};
 for(const [key,when] of Object.entries(tried??{}))if(when>=oldest)next[key]=when;
 for(const p of pending)next[urlSearchKey(p)]=day;
 return next;
}
