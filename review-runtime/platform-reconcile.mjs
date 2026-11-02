// LLM emits candidates only. Deterministic source mapping owns queue creation.
import fs from 'node:fs/promises';import path from 'node:path';import {spawnSync} from 'node:child_process';import {platformSource} from '../lib/platform-discovery.ts';
const input=process.argv[2];if(!input)throw Error('Candidate JSON path required');const publish=process.argv.includes('--publish-queue');
const data=JSON.parse(await fs.readFile(input,'utf8'));if(!Array.isArray(data.candidates)||data.candidates.length>20)throw Error('Invalid bounded candidate payload');
const response=await fetch('https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse?resource=sources');if(!response.ok)throw Error('Source inventory unavailable');const sources=await response.json();
const accepted=[],held=[];
for(const candidate of data.candidates){const source=platformSource(candidate,sources);if(!source){held.push({company:candidate.company,platform:candidate.platform,reason:'Official source identity/origin not uniquely established'});continue;}
 let p;try{p=new URL(candidate.platformUrl)}catch{held.push({company:candidate.company,reason:'Invalid platform URL'});continue;}
 if(p.protocol!=='https:'){held.push({company:candidate.company,reason:'Non-HTTPS platform evidence'});continue;}
 accepted.push({...candidate,sourceId:source.id});}
const queueFile=path.resolve('db/discovery/platform-candidates.json');await fs.mkdir(path.dirname(queueFile),{recursive:true});
let previous=[];try{previous=JSON.parse(await fs.readFile(queueFile)).candidates}catch(e){if(e.code!=='ENOENT')throw e;}
const candidates=[...new Map([...previous,...accepted].map(x=>[x.officialUrl,x])).values()].slice(-100);
await fs.writeFile(queueFile,JSON.stringify({observedAt:new Date().toISOString(),candidates},null,2)+'\n');
const report={accepted:accepted.length,held,queued:candidates.length,dbWrites:0,mailWrites:0,owner:'production-crawl.yml'};
await fs.writeFile(path.join(path.dirname(input),'reconciliation.json'),JSON.stringify(report,null,2));
if(publish){for(const args of [['add','--','db/discovery/platform-candidates.json'],['commit','--only','-m','Queue daily verified-origin platform discovery leads','--','db/discovery/platform-candidates.json'],['push','origin','main']]){const r=spawnSync('git',args,{encoding:'utf8'});if(r.status!==0&&!r.stdout?.includes('nothing to commit'))throw Error('Queue Git operation failed; retained local evidence');}}
console.log(JSON.stringify(report));
