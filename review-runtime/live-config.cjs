const path=require('node:path'),os=require('node:os');
const production='https://job-pulse-realtime.autodev61.chatgpt.site',rehearsal=process.env.JOB_PULSE_REHEARSAL==='1';
const endpoint=new URL(process.env.JOB_PULSE_ENDPOINT??production);
if(endpoint.pathname!=='/'||endpoint.search||endpoint.hash||endpoint.username||endpoint.password)throw Error('Origin only');
if(rehearsal){if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))throw Error('Rehearsal requires localhost, forbids production');}
else if(endpoint.origin!==production)throw Error('Live requires production origin');
const base=rehearsal?path.resolve(process.env.JOB_PULSE_REHEARSAL_BASE??''):path.join(os.homedir(),'Library/Application Support/Job Pulse');
if(rehearsal&&(!process.env.JOB_PULSE_REHEARSAL_BASE||!base.startsWith(os.tmpdir()+path.sep)))throw Error('Rehearsal requires temporary base');
module.exports={production,endpoint:endpoint.origin,rehearsal,base};
