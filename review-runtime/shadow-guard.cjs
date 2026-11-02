// Enforced in every helper process, before any helper can access transport.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');
const root=process.env.JOB_PULSE_PROJECT_ROOT, out=process.env.JOB_PULSE_SHADOW_OUTPUT;
if(!root||!out)throw Error('Shadow project/output required');
const original={read:fsp.readFile.bind(fsp),readSync:fs.readFileSync.bind(fs),write:fsp.writeFile.bind(fsp),readdir:fsp.readdir.bind(fsp)};
const filename=v=>v instanceof URL?require('node:url').fileURLToPath(v):String(v);
const isState=p=>path.basename(p)==='codex-direct-db-gmail-state.json';
const redirected=p=>(path.dirname(p)===path.join(root,'.codex_tmp')&&p.endsWith('.json')&&!isState(p))||path.basename(p)==='undated-source-observations.json'?path.join(out,path.basename(p)):p;
async function read(p,opts){const file=filename(p);if(isState(file)&&process.env.JOB_PULSE_REPLAY_CANDIDATES){
 const current=JSON.parse(await original.read(file,'utf8')),ids=new Set(JSON.parse(await original.read(process.env.JOB_PULSE_REPLAY_CANDIDATES,'utf8'))),asOf=process.env.JOB_PULSE_REPLAY_ASOF;
 const projected={...current,records:Object.fromEntries(Object.entries(current.records).filter(([,r])=>!ids.has(r.jobId)&&(!r.persistedAt||r.persistedAt<asOf)))};
 const text=JSON.stringify(projected);return opts==='utf8'||opts?.encoding==='utf8'?text:Buffer.from(text);
}return original.read(redirected(file),opts);}
fsp.readFile=read;
fs.readFileSync=(p,opts)=>original.readSync(redirected(filename(p)),opts);
fsp.writeFile=async(p,data,opts)=>{const file=filename(p);if(isState(file)||/\.codex-review-token$/.test(file))throw Error('Shadow cannot change durable state/credentials');const target=redirected(file);if(!target.startsWith(out+path.sep))throw Error('Shadow write outside evidence directory');return original.write(target,data,opts);};
fsp.readdir=async(p,opts)=>path.resolve(filename(p))===path.resolve(root,'.codex_tmp')?original.readdir(out,opts):original.readdir(p,opts);
const fetchOriginal=global.fetch;global.fetch=async(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input)),method=String(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
 if(process.env.JOB_PULSE_REPLAY_ASOF)throw Error('Offline replay denies network');
 if(url.hostname==='job-pulse-realtime.autodev61.chatgpt.site'&&!['GET','HEAD'].includes(method))throw Error('Shadow denies all Job Pulse POSTs');
 if(/^(?:r\.jina\.ai)$/.test(url.hostname))throw Error('No reader/proxy bypass in shadow');
 return fetchOriginal(input,init);
};
if(process.env.JOB_PULSE_REPLAY_ASOF){const RealDate=Date,now=Date.parse(process.env.JOB_PULSE_REPLAY_ASOF);global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};}

const syncWrite=fs.writeFileSync.bind(fs);fs.writeFileSync=(p,data,opts)=>{const file=filename(p);if(isState(file)||/\.codex-review-token$/.test(file))throw Error('Shadow cannot change durable state/credentials');const target=redirected(file);if(!target.startsWith(out+path.sep))throw Error('Shadow write outside evidence directory');return syncWrite(target,data,opts);};
require('node:module').syncBuiltinESMExports();
