import './evidence-io.cjs';
import fs from 'node:fs/promises';import path from 'node:path';import {gzipSync,gunzipSync} from 'node:zlib';import {randomUUID,createHash} from 'node:crypto';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{rawRead}=require('./evidence-io.cjs'),config=require('./live-config.cjs');
export const minimumFree=5*1024**3;
export async function assertDisk(directory){const stat=await fs.statfs(directory),free=config.rehearsal&&process.env.JOB_PULSE_TEST_FREE_BYTES!==undefined?Number(process.env.JOB_PULSE_TEST_FREE_BYTES):stat.bavail*stat.bsize;if(!Number.isFinite(free)||free<minimumFree)throw Error('hold-disk: free disk below 5GB ('+free+' bytes available)');return free;}
export async function compressEvidence(directory){
 let beforeBytes=0,afterBytes=0,files=0;
 for(const name of await fs.readdir(directory)){const file=path.join(directory,name),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())continue;beforeBytes+=stat.size;
  const bytes=await rawRead(file);let final=bytes;
  if(/\.(?:json|log)$/.test(name)&&bytes.length>=512&&!(bytes[0]===31&&bytes[1]===139)){
   const packed=gzipSync(bytes,{level:9});if(packed.length<bytes.length){if(!gunzipSync(packed).equals(bytes))throw Error('Evidence gzip verification failed');const temp=file+'.gzip-'+randomUUID(),handle=await fs.open(temp,'wx',0o600);try{await handle.writeFile(packed);await handle.sync();}finally{await handle.close();}await fs.rename(temp,file);final=packed;files++;}
  }
  afterBytes+=final.length;
 }
 const fd=await fs.open(directory,'r');try{await fd.sync();}finally{await fd.close();}
 const metrics={beforeBytes,afterBytes,files,beforeMB:beforeBytes/1e6,afterMB:afterBytes/1e6};await fs.writeFile(path.join(directory,'compression.json'),JSON.stringify(metrics));return metrics;
}
