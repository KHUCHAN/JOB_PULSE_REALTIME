const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const io={read:fs.readFileSync.bind(fs),open:fs.openSync.bind(fs),write:fs.writeFileSync.bind(fs),sync:fs.fsyncSync.bind(fs),close:fs.closeSync.bind(fs),rename:fs.renameSync.bind(fs)};
function parse(data){const s=JSON.parse(String(data));if(!s.records||Array.isArray(s.records)||typeof s.records!=='object')throw Error('Invalid state records');return s;}
function superset(before,after){for(const [key,r] of Object.entries(before.records)){const n=after.records[key];if(!n||Object.entries(r).some(([k,v])=>!['sentAt','identityAlreadyNotified'].includes(k)&&JSON.stringify(n[k])!==JSON.stringify(v))||r.sentAt&&!n.sentAt||r.identityAlreadyNotified&&!n.identityAlreadyNotified)throw Error('State record lost or regressed: '+key);}}
function atomic(file,data,{state=false,exclusive=false}={}){
 const next=state?parse(data):JSON.parse(String(data));
 if(state)superset(parse(io.read(file)),next);
 if(exclusive&&fs.existsSync(file))throw Error('Exclusive record exists: '+file);
 const tmp=file+'.atomic-'+crypto.randomUUID(),fd=io.open(tmp,'wx',0o600);
 try{io.write(fd,data);io.sync(fd);}finally{io.close(fd);}
 const checked=io.read(tmp);state?parse(checked):JSON.parse(String(checked));
 // Rehearsal-only pause lets the test kill a writer after fsync, before rename.
 if(state&&process.env.JOB_PULSE_REHEARSAL==='1'&&process.env.JOB_PULSE_TEST_STATE_PAUSE){io.write(process.env.JOB_PULSE_TEST_STATE_PAUSE,String(process.pid));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000);}
 io.rename(tmp,file);const dir=io.open(path.dirname(file),'r');try{io.sync(dir);}finally{io.close(dir);}
}
module.exports={atomic,parse,superset};
