import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
export function auditLaunchdJobs(jobs,expected=['com.jobpulse.review-shadow','com.jobpulse.platform-daily','com.jobpulse.review-live','com.jobpulse.live-watchdog']){
 return jobs.filter(j=>j.label.startsWith('com.jobpulse.')&&(!expected.includes(j.label)||j.keepAlive)).map(j=>({label:j.label,reason:j.keepAlive?'KeepAlive forbidden':'unexpected job'}));
}
export async function inspectLaunchd(expected){
 const domain='gui/'+process.getuid(),listing=(await exec('/bin/launchctl',['list'])).stdout;
 const labels=[...listing.matchAll(/\b(com\.jobpulse\.[\w.-]+)/g)].map(m=>m[1]);const jobs=[];
 for(const label of labels){const detail=(await exec('/bin/launchctl',['print',domain+'/'+label])).stdout;jobs.push({label,keepAlive:/\bkeepalive\s*=\s*(?:1|true)|properties =[^\n]*keepalive/i.test(detail),detail});}
 for(const j of jobs){try{const p=JSON.parse((await exec('/usr/bin/plutil',['-convert','json','-o','-',process.env.HOME+'/Library/LaunchAgents/'+j.label+'.plist'])).stdout);j.keepAlive ||= p.KeepAlive===true||!!p.KeepAlive&&typeof p.KeepAlive==='object';}catch{}}
 return {jobs:jobs.map(({detail,...j})=>j),blockers:auditLaunchdJobs(jobs,expected)};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await inspectLaunchd(process.argv.includes('--legacy')?['com.jobpulse.review-shadow','com.jobpulse.platform-daily']:undefined)));
