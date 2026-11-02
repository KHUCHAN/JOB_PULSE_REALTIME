import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),runtime=process.env.JOB_PULSE_RUNTIME??path.resolve(dir,'../../review-runtime');
const day=new Date().toISOString().slice(0,10),root=path.join(runtime,'platform-runs',day);await fs.mkdir(root,{recursive:true});
let ledger=[];try{ledger=JSON.parse(await fs.readFile(path.join(root,'usage.json')))}catch(e){if(e.code!=='ENOENT')throw e;}
const used=ledger.reduce((n,x)=>n+(x.inputTokens??0),0);if(ledger.some(x=>x.inputTokens>0)){console.log(JSON.stringify({status:'already-completed-today',inputTokens:used,root}));process.exit(0);}
if(ledger.some(x=>x.status==='running'||x.status==='unknown'))throw Error('Prior platform usage unresolved; daily lane held');
if(used>=300000)throw Error('Daily 300,000 input-token cap reached');
// 100k context and a bounded tool-call brief bound the first run; actual cumulative
// usage is checked per completed turn and the child is stopped at the daily cap.
const args=['exec','--ephemeral','--ignore-user-config','--strict-config','--sandbox','read-only','--skip-git-repo-check','--disable','apps','--disable','plugins','--disable','shell_tool','--disable','unified_exec','--disable','memories','-c','memories.use_memories=false','-c','web_search="live"','-c','model_context_window=20000','-c','model_auto_compact_token_limit=16000','--output-schema',path.join(dir,'platform.schema.json'),'--json','-C',root,'-'];
const log=await fs.open(path.join(root,`session-${Date.now()}.jsonl`),'wx'),err=await fs.open(path.join(root,`session-${Date.now()}.stderr`),'wx');
ledger.push({at:new Date().toISOString(),status:'running'});await fs.writeFile(path.join(root,'usage.json'),JSON.stringify(ledger,null,2));
const child=spawn(process.env.JOB_PULSE_CODEX??'codex',args,{stdio:['pipe','pipe',err.fd]});child.stdin.end(await fs.readFile(path.join(dir,'platform-prompt.txt'),'utf8'));
const finished=new Promise(resolve=>child.on('close',resolve));
let buffer='',final='',usage=null,toolCalls=0;let counter=used;
for await(const chunk of child.stdout){await log.write(chunk);buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{const event=JSON.parse(line);if(event.type==='item.started'&&event.item?.type==='web_search'&&++toolCalls>6)child.kill('SIGTERM');if(event.type==='item.completed'&&event.item?.type==='agent_message')final=event.item.text;if(event.type==='turn.completed'){usage=event.usage;counter=used+usage.input_tokens;if(counter>300000)child.kill('SIGTERM');}}catch{}}}
await finished;await log.close();await err.close();
if(!usage)throw Error('Platform session did not return token usage; no further daily calls permitted until reconciled');
ledger[ledger.length-1]={at:new Date().toISOString(),status:'completed',inputTokens:usage.input_tokens,cachedInputTokens:usage.cached_input_tokens,outputTokens:usage.output_tokens};await fs.writeFile(path.join(root,'usage.json'),JSON.stringify(ledger,null,2));
if(counter>300000)throw Error('Platform token cap exceeded; discard candidates and require budget review');
const data=JSON.parse(final);await fs.writeFile(path.join(root,'candidates.json'),JSON.stringify(data,null,2));console.log(JSON.stringify({root,usage,candidates:data.candidates.length,platforms:data.platforms}));
