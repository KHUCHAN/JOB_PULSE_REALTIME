// Only roots created by this process may be removed. Never traverse symlinks.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {afterEach,after} from 'node:test';import {createHash} from 'node:crypto';
const owned=new Set(),closers=new Map();export const minimumFree=5*1024**3;
export async function temporary(prefix){const s=await fs.statfs(os.tmpdir());if(s.bavail*s.bsize<minimumFree)throw Error('Rehearsal aborted: free disk below 5GB');const root=await fs.mkdtemp(path.join(os.tmpdir(),prefix));owned.add(root);return root;}
async function writable(dir){const s=await fs.lstat(dir);if(!s.isDirectory()||s.isSymbolicLink())return;await fs.chmod(dir,0o700);for(const name of await fs.readdir(dir))await writable(path.join(dir,name));}
export function onCleanup(root,fn){closers.set(root,fn);}
export async function removeFixture(root){if(!owned.has(root))throw Error('Refusing to remove unowned fixture');try{if(closers.has(root)){await closers.get(root)();closers.delete(root);}await writable(root);await fs.rm(root,{recursive:true,force:true});owned.delete(root);}catch(e){if(e.code==='ENOENT')owned.delete(root);else throw e;}}
export async function cleanup(){for(const root of [...owned])await removeFixture(root);}
afterEach(cleanup);after(cleanup);
export async function size(dir){let total=0;for(const name of await fs.readdir(dir)){const file=path.join(dir,name),s=await fs.lstat(file);if(s.isSymbolicLink())continue;total+=s.isDirectory()?await size(file):s.size;}return total;}
let printed=false;export async function measure(root,label){const bytes=await size(root);if(bytes>=5_000_000)throw Error('Fixture exceeds 5MB: '+bytes);if(!printed){console.log(label+' fixture measured '+(bytes/1e6).toFixed(3)+' MB (symlinks excluded)');printed=true;}return bytes;}
export async function snapshotProjection(snapshot){const bytes=await fs.readFile(path.join(snapshot,'.codex_tmp/codex-direct-db-gmail-state.json')),full=JSON.parse(bytes),entries=Object.entries(full.records),held=new Set(['0372c3b6-f552-4eda-b4cc-4e7d1e807664','035b9146-f749-4e3f-8d85-2c753e4287ab','6507b05a-279b-4bba-9bb7-14e60bc9db9f','90f82229-368f-49cc-8f9a-5f48b3ce0f6c','eaf48f95-7b8b-4e63-aaf9-b2f27453c13e']);
 const selected=new Map(entries.filter(([,r])=>held.has(r.jobId)));for(const predicate of [r=>r.sentAt,r=>r.decision==='reject',r=>r.decision==='approve',r=>r.baseline])for(const e of entries.filter(([,r])=>predicate(r)).slice(-3))selected.set(...e);
 return {state:{...full,records:Object.fromEntries(selected)},provenance:{snapshotSha256:createHash('sha256').update(bytes).digest('hex'),snapshotRecords:entries.length,projectedRecords:selected.size,retainedHeldIds:[...selected.values()].filter(r=>held.has(r.jobId)).map(r=>r.jobId)}};
}
