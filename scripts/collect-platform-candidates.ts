// This stage runs ONLY inside the admitted production-crawl owner. Local use
// is read-only by default and cannot mint production ingest authority.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {officialPlatformJob,platformSource,type PlatformCandidate} from '../lib/platform-discovery.ts';
import type {CrawlSource} from '../lib/crawler.ts';
import {ingestJobSnapshotInChunks} from '../lib/job-snapshot-transport.ts';
const base='https://job-pulse-realtime.autodev61.chatgpt.site',api=base+'/api/pulse';
const dry=process.argv.includes('--dry-run')||process.env.GITHUB_ACTIONS!=='true';
const inventory=await fetch(api+'?resource=sources');if(!inventory.ok)throw Error('Source GET failed');const sources=await inventory.json() as CrawlSource[];
let queue:PlatformCandidate[]=[];try{queue=JSON.parse(await readFile('db/discovery/platform-candidates.json','utf8')).candidates;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
const results=[];
for(const candidate of queue.slice(0,100)){
 const source=platformSource(candidate,sources);if(!source){results.push({platform:candidate.platform,status:'hold',reason:'No unique official source/origin'});continue;}
 try{
  const response=await fetch(candidate.officialUrl,{signal:AbortSignal.timeout(15000),redirect:'manual'});
  if(!response.ok){results.push({platform:candidate.platform,status:response.status===403?'blocked':'hold',httpStatus:response.status});continue;}
  const job=officialPlatformJob(candidate,source,await response.text());if(!job){results.push({platform:candidate.platform,status:'hold',reason:'Official identity/US/body proof unavailable'});continue;}
  const lookup=new URL(api);lookup.search=new URLSearchParams({resource:'jobs',company:source.company,q:job.requisitionId??job.title,pageSize:'100',resumeMatch:'chanyoung-resume'}).toString();
  const existing=await fetch(lookup,{signal:AbortSignal.timeout(30000)});if(!existing.ok)throw Error('Exact DB lookup failed; no ingestion');
  const rows=(await existing.json() as {items:Array<{officialUrl:string;requisitionId?:string;title:string}>}).items;
  if(rows.some(row=>row.officialUrl===job.officialUrl||(job.requisitionId&&row.requisitionId===job.requisitionId))){results.push({platform:candidate.platform,status:'already-in-db',sourceId:source.id});continue;}
  if(dry){results.push({platform:candidate.platform,status:'verified-read-only',sourceId:source.id});continue;}
  const authorization=async()=>{const url=process.env.ACTIONS_ID_TOKEN_REQUEST_URL,token=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;if(!url||!token)throw Error('Existing owner OIDC required');const u=new URL(url);u.searchParams.set('audience','job-pulse-realtime');const r=await fetch(u,{headers:{authorization:`Bearer ${token}`}});if(!r.ok)throw Error('Owner OIDC unavailable');return (await r.json() as {value:string}).value;};
  const result=await ingestJobSnapshotInChunks({sourceId:source.id,listingUrl:source.postingUrl,jobs:[job],allowedOrigins:[new URL(job.officialUrl).origin],authorization,completeListing:false,endpoint:api,retentionNow:new Date().toISOString()});
  results.push({platform:candidate.platform,status:'ingested',sourceId:source.id,created:result.created,updated:result.updated});
 }catch(error){results.push({platform:candidate.platform,status:'error',reason:(error as Error).message});}
}
await mkdir('output/platform-discovery',{recursive:true});await writeFile('output/platform-discovery/results.json',JSON.stringify({at:new Date().toISOString(),dryRun:dry,candidates:queue.length,results},null,2));
console.log(JSON.stringify({dryRun:dry,candidates:queue.length,created:results.reduce((n,r)=>n+('created'in r?Number(r.created):0),0),results}));
