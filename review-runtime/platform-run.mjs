// Daily platform stage. --merge combines what the scripts read. Otherwise it asks Codex for the official URLs of rows nothing else resolved, and starts no Codex session when there are none.
import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {mergeLeads} from './handshake-policy.mjs';import {URL_SEARCH_ENABLED,pendingUrlSearches,applyFound,markTried} from './platform-policy.mjs';import {LEAN_CODEX} from './codex-lean.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),runtime=process.env.JOB_PULSE_RUNTIME??path.resolve(dir,'../../review-runtime');
const day=new Date().toISOString().slice(0,10),root=path.join(runtime,'platform-runs',day);await fs.mkdir(root,{recursive:true});
const readJson=async(file,fallback)=>{try{return JSON.parse(await fs.readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
if(process.argv[2]==='--merge'){
 let data={platforms:[{name:'Muse',status:'unavailable',reason:'Disabled; not opened.',evidenceUrl:''},{name:'Indeed',status:'unavailable',reason:'Not attempted; public pages returned no usable rows.',evidenceUrl:''},{name:'Glassdoor',status:'unavailable',reason:'Not attempted; public pages returned no usable rows.',evidenceUrl:''}],candidates:[]};
 const handshake=await readJson(path.join(root,'handshake-leads.json'),null),linkedin=await readJson(path.join(root,'linkedin-leads.json'),null);
 if(handshake)data=mergeLeads(data,handshake);
 if(linkedin)data=mergeLeads(data,linkedin,20,{name:'LinkedIn',via:'from logged-out public pages',evidenceUrl:'https://www.linkedin.com/jobs/search'});
 await fs.writeFile(process.argv[3],JSON.stringify(data,null,2));console.log(JSON.stringify({status:'merged',candidates:data.candidates.length}));process.exit(0);
}
const input=process.argv[2];if(!input)throw Error('Resolved candidate JSON path required');
const usagePath=path.join(root,'usage.json'),triedPath=path.join(runtime,'url-search-tried.json');
const ledger=await readJson(usagePath,[]);
if(ledger.some(x=>x.status==='completed')){console.log(JSON.stringify({status:'already-completed-today',root}));process.exit(0);}
if(ledger.some(x=>x.status==='running'))throw Error('Prior platform usage unresolved; no further calls today');
const data=JSON.parse(await fs.readFile(input,'utf8')),tried=await readJson(triedPath,{});
const inventory=await fetch('https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse?resource=sources',{signal:AbortSignal.timeout(30000)});if(!inventory.ok)throw Error('Source inventory unavailable');
const pending=pendingUrlSearches(data.candidates,tried,await inventory.json());
const save=entry=>fs.writeFile(usagePath,JSON.stringify([...ledger,{at:new Date().toISOString(),...entry}],null,2));
if(!URL_SEARCH_ENABLED||!pending.length){const reason=URL_SEARCH_ENABLED?'no-unresolved-rows':'url-search-off';await save({status:'completed',inputTokens:0,reason});console.log(JSON.stringify({status:'no-codex-call',reason,unresolved:pending.length,inputTokens:0}));process.exit(0);}
const args=['exec','--ephemeral','--ignore-user-config','--strict-config','--sandbox','read-only','--skip-git-repo-check','--disable','apps','--disable','plugins','--disable','shell_tool','--disable','unified_exec','--disable','memories',...LEAN_CODEX,'-c','memories.use_memories=false','-c','web_search="live"','-c','model_context_window=40000','-c','model_auto_compact_token_limit=38000','--output-schema',path.join(dir,'platform.schema.json'),'--json','-C',root,'-'];
const stamp=Date.now(),log=await fs.open(path.join(root,`session-${stamp}.jsonl`),'wx'),err=await fs.open(path.join(root,`session-${stamp}.stderr`),'wx');
await save({status:'running'});
const child=spawn(process.env.JOB_PULSE_CODEX??'codex',args,{stdio:['pipe','pipe',err.fd]});child.stdin.end(await fs.readFile(path.join(dir,'platform-prompt.txt'),'utf8')+'\n'+JSON.stringify(pending)+'\n');
const finished=new Promise(resolve=>child.on('close',resolve));
let buffer='',final='',usage=null,toolCalls=0;
for await(const chunk of child.stdout){await log.write(chunk);buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{const event=JSON.parse(line);if(event.type==='item.started'&&event.item?.type==='web_search'&&++toolCalls>3)child.kill('SIGTERM');if(event.type==='item.completed'&&event.item?.type==='agent_message')final=event.item.text;if(event.type==='turn.completed')usage=event.usage;}catch{}}}
await finished;await log.close();await err.close();
if(!usage)throw Error('Platform session did not return token usage; no further calls today');
await save({status:'completed',inputTokens:usage.input_tokens,cachedInputTokens:usage.cached_input_tokens,outputTokens:usage.output_tokens,toolCalls});
await fs.writeFile(triedPath,JSON.stringify(markTried(tried,pending,day),null,2));
let found=[];try{found=JSON.parse(final).found}catch{}
const applied=applyFound(data.candidates,pending,found);await fs.writeFile(input,JSON.stringify(data,null,2));
console.log(JSON.stringify({status:'searched',searched:pending.length,applied,toolCalls,usage}));
