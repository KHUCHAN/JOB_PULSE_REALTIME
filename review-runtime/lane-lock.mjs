import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
export async function acquireReviewLock(){if(process.env.JOB_PULSE_REVIEW_LOCK==='held')return;
 const child=spawn('/usr/local/bin/python3',[fileURLToPath(new URL('./lane-lock.py',import.meta.url)),process.execPath,...process.argv.slice(1)],{env:process.env,stdio:'inherit'});
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});process.exit(code??1);
}
