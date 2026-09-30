import { crawlSource, type CrawlSource } from '../lib/crawler.ts';
import { mkdir, writeFile } from 'node:fs/promises';
const requested = new Set(process.argv.slice(2));
const inventory = await fetch('https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse?resource=sources').then(r=>r.json()) as Array<CrawlSource & {health: string}>;
const sources = inventory.filter(s=>requested.size ? requested.has(s.id) : ['failed','stale'].includes(s.health));
const directory = `output/nonblocked-probe-${new Date().toISOString().replace(/[:.]/g,'-')}`;
await mkdir(directory,{recursive:true});
let cursor=0;
await Promise.all(Array.from({length:3},async()=>{while(cursor<sources.length){
 const source=sources[cursor++],start=Date.now(),responses:Array<{url:string;status:number;finalUrl:string;body:string}>=[];
 const fetcher:typeof fetch=async(input,init)=>{const response=await fetch(input,init);const copy=response.clone();responses.push({url:String(input),status:response.status,finalUrl:response.url,body:await copy.text()});return response;};
 const result=await crawlSource(source,fetcher,new Date());
 await writeFile(`${directory}/${source.id}.json`,JSON.stringify({source,result,responses},null,2));
 console.log(JSON.stringify({id:source.id,company:source.company,status:result.status,jobs:result.jobs.length,complete:result.completeListing,error:result.error,elapsedMs:Date.now()-start,path:`${directory}/${source.id}.json`}));
}}));
