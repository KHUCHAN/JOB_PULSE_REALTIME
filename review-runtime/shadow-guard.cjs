require('./evidence-io.cjs');
require('./desktop-guard.cjs');
// Enforced in every helper process, before any helper can access transport.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');
const root=process.env.JOB_PULSE_PROJECT_ROOT, out=process.env.JOB_PULSE_SHADOW_OUTPUT;
const {atomic}=require('./atomic-state.cjs');
const config=require('./live-config.cjs');
const live=process.env.JOB_PULSE_LIVE_TRANSPORT==='authorized';
if(!root||!out)throw Error('Shadow project/output required');
const original={read:fsp.readFile.bind(fsp),readSync:fs.readFileSync.bind(fs),write:fsp.writeFile.bind(fsp),readdir:fsp.readdir.bind(fsp)};
const filename=v=>v instanceof URL?require('node:url').fileURLToPath(v):String(v);
const isState=p=>path.basename(p)==='codex-direct-db-gmail-state.json';
const redirected=p=>path.basename(p)==='pre-persistence-policy-check.json'?path.join(out,'pre-persistence-policy-check.json'):((path.dirname(p)===path.join(root,'.codex_tmp')&&p.endsWith('.json')&&!isState(p)&&!p.endsWith('-external-delivery-exclusion.review.json'))||['undated-source-observations.json','community-lookup-checkpoints.json'].includes(path.basename(p)))?path.join(out,path.basename(p)):p;
async function read(p,opts){const file=filename(p);if(isState(file)&&process.env.JOB_PULSE_REPLAY_CANDIDATES){
 const current=JSON.parse(await original.read(file,'utf8')),ids=new Set(JSON.parse(await original.read(process.env.JOB_PULSE_REPLAY_CANDIDATES,'utf8'))),asOf=process.env.JOB_PULSE_REPLAY_ASOF;
 const projected={...current,records:Object.fromEntries(Object.entries(current.records).filter(([,r])=>!r.persistedAt||r.persistedAt<asOf))};
 const text=JSON.stringify(projected);return opts==='utf8'||opts?.encoding==='utf8'?text:Buffer.from(text);
}return original.read(redirected(file),opts);}
fsp.readFile=read;
fs.readFileSync=(p,opts)=>original.readSync(redirected(filename(p)),opts);
fsp.writeFile=async(p,data,opts)=>{const file=filename(p);if(/\.codex-review-token$/.test(file)||(!live&&isState(file)))throw Error('Shadow cannot change durable state/credentials');if(live&&isState(file))return atomic(file,data,{state:true});const target=redirected(file);if(!target.startsWith(out+path.sep))throw Error('Shadow write outside evidence directory');return original.write(target,data,opts);};
fsp.readdir=async(p,opts)=>path.resolve(filename(p))===path.resolve(root,'.codex_tmp')?[...new Set([...(await original.readdir(p,opts)),...(await original.readdir(out,opts))])]:original.readdir(p,opts);
const fetchOriginal=global.fetch;global.fetch=async(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input)),method=String(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
 if(process.env.JOB_PULSE_REPLAY_ASOF)throw Error('Offline replay denies network');
 if(url.origin===config.production||url.origin===config.endpoint){
  if(config.rehearsal){url.host=new URL(config.endpoint).host;url.protocol='http:';input=url.href;}
 }
 if(config.rehearsal&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Rehearsal denies external network');
 if((url.origin===config.production||url.origin===config.endpoint)&&!['GET','HEAD'].includes(method)){
  if(!live)throw Error('Shadow denies all Job Pulse POSTs');
  if(url.href!==config.endpoint+'/api/pulse'||method!=='POST')throw Error('Live transport endpoint denied');
  await require('./assert-paused.cjs').assertPaused();
  await (await import('./disk-evidence.mjs')).assertDisk(root);
  const payload=JSON.parse(init?.body??'null'),action=payload?.action;
  if(action==='submitCodexReview'){
   if(process.env.JOB_PULSE_LIVE_STAGE!=='persist'||payload.dispatch!==false||!Array.isArray(payload.reviews)||!payload.reviews.length||payload.reviews.length>100)throw Error('Review transport guard failed');
  }else if(action==='dispatchCodexReviewBatch'){
   if(process.env.JOB_PULSE_LIVE_STAGE!=='dispatch'||!Array.isArray(payload.jobIds)||!payload.jobIds.length||payload.jobIds.length>500)throw Error('Dispatch transport guard failed');
   const sent=path.join(out,'mail-attempt-once.json');await original.write(sent,JSON.stringify({at:new Date().toISOString()}),{flag:'wx',mode:0o600});
  }else throw Error('Live action denied');
  const stamp=process.env.JOB_PULSE_STAMP,scan=JSON.parse(await original.read(path.join(out,stamp+'.json'),'utf8'));
  const ids=action==='submitCodexReview'?payload.reviews.map(r=>r.jobId):payload.jobIds;
  if(action==='submitCodexReview')for(const name of await original.readdir(out))if(name.startsWith('post-attempt-')){
   const prior=JSON.parse(await original.read(path.join(out,name),'utf8'));
   if(prior.action===action&&prior.ids.some(id=>ids.includes(id)))throw Error('Review POST already attempted for id in this run; never retry uncertain POST');
  }
  let pending={details:[]};
  if(action==='dispatchCodexReviewBatch')try{pending=JSON.parse(await original.read(path.join(out,stamp+'-pending.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const identities=ids.map(id=>[...scan.details,...pending.details].find(x=>x.row.id===id)?.row??{id});
  const attempt=path.join(out,'post-attempt-'+require('node:crypto').randomUUID()+'.json');
  atomic(attempt,JSON.stringify({at:new Date().toISOString(),action,ids,identities,payload,status:'attempting'}),{exclusive:true});
  // No retry. The durable attempting record excludes every identity on later runs.
  const response=await fetchOriginal(input,{...init,...(config.rehearsal?{signal:AbortSignal.timeout(Number(process.env.JOB_PULSE_TEST_TIMEOUT??5000))}:{})});
  if(config.rehearsal&&process.env.JOB_PULSE_TEST_KILL_AFTER===action)process.kill(process.pid,'SIGKILL');
  atomic(attempt,JSON.stringify({at:new Date().toISOString(),action,ids,identities,payload,status:'unresolved',httpStatus:response.status}));
  return response;
 }
 if(!['GET','HEAD'].includes(method))throw Error('Unapproved transport');
 if(/^(?:r\.jina\.ai)$/.test(url.hostname))throw Error('No reader/proxy bypass in shadow');
 return fetchOriginal(input,init);
};
if(process.env.JOB_PULSE_REPLAY_ASOF){const RealDate=Date,now=Date.parse(process.env.JOB_PULSE_REPLAY_ASOF);global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};}

const syncWrite=fs.writeFileSync.bind(fs);fs.writeFileSync=(p,data,opts)=>{const file=filename(p);if(/\.codex-review-token$/.test(file)||(!live&&isState(file)))throw Error('Shadow cannot change durable state/credentials');if(live&&isState(file))return atomic(file,data,{state:true});const target=redirected(file);if(!target.startsWith(out+path.sep))throw Error('Shadow write outside evidence directory');return syncWrite(target,data,opts);};
require('node:module').syncBuiltinESMExports();
