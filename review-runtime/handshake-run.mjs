// One Codex call per UTC day reads Handshake through the user's connected Chrome. The page text goes
// to a file, so the model only ever sees a status and a row count. A failure here never blocks the daily lane.
import fs from 'node:fs/promises';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {HANDSHAKE_QUERIES,selectLeads} from './handshake-policy.mjs';import {findGaps} from './platform-gaps.mjs';import {LEAN_CODEX} from './codex-lean.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),runtime=process.env.JOB_PULSE_RUNTIME??path.resolve(dir,'../../review-runtime');
const day=new Date().toISOString().slice(0,10),root=path.join(runtime,'platform-runs',day),work=path.join(root,'handshake'),reportPath=path.join(root,'handshake-leads.json'),ledgerPath=path.join(root,'handshake-usage.json');
await fs.mkdir(work,{recursive:true});
const finish=async report=>{await fs.writeFile(reportPath,JSON.stringify({at:new Date().toISOString(),...report},null,2));const {gaps,notInInventory,...brief}=report;console.log(JSON.stringify({...brief,gaps:gaps?.length,notInInventory:notInInventory?.length}));process.exit(0);};
let ledger=[];try{ledger=JSON.parse(await fs.readFile(ledgerPath,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;}
// A successful read is final for the day; a failed one gets one more try, so a bad day costs two calls at most.
let previous=null;try{previous=JSON.parse(await fs.readFile(reportPath,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;}
const attempts=ledger.filter(x=>x.inputTokens>0).length;
if(previous?.status==='checked'||attempts>=2){console.log(JSON.stringify({status:'already-read-today',attempts,previous:previous?.status}));process.exit(0);}
let repl;try{repl=JSON.parse(process.env.JOB_PULSE_NODE_REPL)}catch{await finish({status:'unavailable',reason:'Codex node_repl config not found'});}
if(spawnSync('/usr/bin/pgrep',['-x','Google Chrome']).status!==0)await finish({status:'unavailable',reason:'Chrome is not running'});
const codexHome=repl.env.CODEX_HOME,out=path.join(work,'rows.json');await fs.rm(out,{force:true});
const code=(await fs.readFile(path.join(dir,'handshake-read.js'),'utf8')).replace('__CLIENT__',()=>JSON.stringify(path.join(codexHome,'plugins/cache/openai-bundled/chrome/latest/scripts/browser-client.mjs'))).replace('__QUERIES__',()=>JSON.stringify(HANDSHAKE_QUERIES)).replace('__PAGES__','1').replace('__OUT__',()=>JSON.stringify(out));
const prompt='Call the node_repl js tool exactly once with exactly this code and timeout_ms 240000, then reply with only the text it wrote. Do nothing else. Do not click, type, log in, apply, or submit anything.\n\n'+code;
const lit=v=>"'"+v+"'",env={...repl.env,BROWSER_USE_AVAILABLE_BACKENDS:'chrome'};
const args=['exec','--ephemeral','--ignore-user-config','--strict-config','--sandbox','workspace-write','--skip-git-repo-check','--disable','apps','--disable','plugins','--disable','shell_tool','--disable','unified_exec','--disable','memories',...LEAN_CODEX,'-c','memories.use_memories=false','-c','approval_policy="never"','-c','model_context_window=60000','-c','model_auto_compact_token_limit=50000','-c',`mcp_servers.node_repl.command="${repl.command}"`,'-c','mcp_servers.node_repl.startup_timeout_sec=60','-c','mcp_servers.node_repl.tool_timeout_sec=280','-c','mcp_servers.node_repl.tools.js.approval_mode="approve"','-c',`mcp_servers.node_repl.env={${Object.entries(env).map(([k,v])=>`${k}=${lit(v)}`).join(',')}}`,'--json','-C',work,'-'];
const once=()=>new Promise(resolve=>{
 const child=spawn(env.CODEX_CLI_PATH??process.env.JOB_PULSE_CODEX??'codex',args,{stdio:['pipe','pipe','ignore']});let buffer='',usage=null,failed=null,calls=0;
 const timer=setTimeout(()=>child.kill('SIGTERM'),300000);child.stdin.end(prompt);
 child.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const e=JSON.parse(line);if(e.type==='item.started'&&e.item?.type==='mcp_tool_call'&&++calls>1)child.kill('SIGTERM');if(e.type==='turn.completed')usage=e.usage;if(e.type==='turn.failed')failed=e.error?.message??'turn failed';}catch{}}});
 child.on('close',()=>{clearTimeout(timer);resolve({usage,failed});});
});
let result=await once();
if(!result.usage&&/capacity/i.test(result.failed??'')){await new Promise(r=>setTimeout(r,60000));result=await once();}
ledger.push({at:new Date().toISOString(),inputTokens:result.usage?.input_tokens??0,cachedInputTokens:result.usage?.cached_input_tokens??0,outputTokens:result.usage?.output_tokens??0});await fs.writeFile(ledgerPath,JSON.stringify(ledger,null,2));
let read;try{read=JSON.parse(await fs.readFile(out,'utf8'))}catch{await finish({status:'unavailable',reason:result.failed??'Connected Chrome did not return Handshake rows'});}
if(read.status!=='checked'&&!read.rows.length)await finish({status:read.status,reason:read.reason});
const leads=selectLeads(read.rows),unique=new Set(read.rows.map(r=>r.id)).size;
const found=await findGaps(leads,runtime,day);if(!found)await finish({status:'checked',reason:'Source inventory unavailable; no gaps computed',rows:read.rows.length,unique,selected:leads.length});
await finish({status:read.status,reason:read.reason,rows:read.rows.length,unique,selected:leads.length,inDb:found.inDb,lookupErrors:found.lookupErrors,gaps:found.gaps.slice(0,12),notInInventory:found.notInInventory.map(({company,title,location,platformUrl})=>({company,title,location,platformUrl}))});
