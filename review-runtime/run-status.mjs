import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile);
export const statusFile=path.join(os.homedir(),'Library/Application Support/Job Pulse/review-runtime/live-status.jsonl');
export async function localNotify(kind){
 const message=kind==='test'?'This is a Job Pulse test notification.':kind==='watchdog'?'No completed live review in 9 hours. Check local Job Pulse status.':'Live review held or failed. Check local Job Pulse status.';
 return await exec('/usr/bin/osascript',['-e',`display notification ${JSON.stringify(message)} with title "Job Pulse"`],{timeout:10000});
}
export async function recordRun({status,out,at=new Date().toISOString()}, {file=statusFile,notify=localNotify}={}){
 const runId=process.env.JOB_PULSE_STATUS_RUN_ID??out??at;
 let prior='';try{prior=await fs.readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
 const existing=prior.trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)).find(e=>e.runId===runId);if(existing)return existing;
 const entry={at,status,out,runId};await fs.appendFile(file,JSON.stringify(entry)+'\n',{mode:0o600});
 if(status!=='complete')await notify('hold').catch(()=>{});return entry;
}
export function watchdogDue(entries,asOf,activatedAt){
 const completed=entries.filter(e=>e.status==='complete').map(e=>Date.parse(e.at)).filter(Number.isFinite);
 const last=completed.length?Math.max(...completed):Date.parse(activatedAt);
 return Number.isFinite(last)&&Date.parse(asOf)-last>=9*3600000;
}
export async function checkWatchdog({file=statusFile,asOf=new Date().toISOString(),activatedAt,notify=localNotify}={}){
 let text='';try{text=await fs.readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
 const entries=text.trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));const due=watchdogDue(entries,asOf,activatedAt);
 // Notify once per nine-hour outage; completed runs restart the window.
 const lastNotice=entries.filter(e=>e.status==='watchdog').at(-1);
 const alert=due&&(!lastNotice||Date.parse(asOf)-Date.parse(lastNotice.at)>=9*3600000);
 if(alert){await notify('watchdog');await fs.appendFile(file,JSON.stringify({at:asOf,status:'watchdog'})+'\n',{mode:0o600});}
 return {due,notified:alert};
}

if(process.argv.includes('--scheduler-failure'))await recordRun({status:'hold-scheduler'});
