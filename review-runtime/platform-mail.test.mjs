import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {mailExcluded,mergeQueue,selectForMail,toPayload,sameLead,reservePlatformLeads,settlePlatformLeads,readLedger,QUEUE,PLAN} from './platform-mail.mjs';
const now='2026-11-05T12:00:00.000Z',row=(company,title,extra={})=>({platform:'LinkedIn',company,title,location:'Austin, TX',platformUrl:'https://www.linkedin.com/jobs/view/1',...extra});
const entry=(company,title,firstSeenAt=now,platform='LinkedIn')=>({platform,company,title,locations:['Austin, TX'],url:'https://www.linkedin.com/jobs/view/1',firstSeenAt});

test('same lead needs the exact title and allows an employer suffix',()=>{
 assert(sameLead({company:'TikTok USDS Joint Venture',title:'ML Intern'},{company:'TikTok',title:'ml intern'}));
 assert(!sameLead({company:'TikTok',title:'ML Intern'},{company:'TikTok',title:'ML Engineer Intern'}));
 assert(!sameLead({company:'General Motors',title:'ML Intern'},{company:'General Mills',title:'ML Intern'}));
 assert(!sameLead({company:'',title:'ML Intern'},{company:'',title:'ML Intern'}));
});
test('Skillbridge and undergraduate-only titles are left out of the mail',()=>{
 for(const title of ['Data Engineer (Skillbridge Intern) - 28499','Operations Data Analytics Intern (Undergraduate Students Only)','Campus Undergraduate Summer Internship Program - 2027 AI Engineer','Undergrad Data Intern'])assert(mailExcluded({title}),title);
 for(const title of ['Campus Graduate Masters Summer Internship Program - 2027 AI Engineer','Data Intern (Undergraduate or Graduate)','Undergraduate/Masters Data Intern','Data Science Intern'])assert(!mailExcluded({title}),title);
});
test('a role in several cities is one queue row and keeps its first date',()=>{
 const first=mergeQueue([],[row('A','X'),row('A','X',{location:'Boston, MA'})],'2026-11-04T00:00:00.000Z');
 assert.equal(first.queue.length,1);assert.deepEqual(first.queue[0].locations,['Austin, TX','Boston, MA']);
 const second=mergeQueue(first.queue,[row('A','X')],now);assert.equal(second.added.length,0);assert.equal(second.queue[0].firstSeenAt,'2026-11-04T00:00:00.000Z');
});
test('queue rows drop after 30 days',()=>assert.equal(mergeQueue([entry('A','X','2026-10-01T00:00:00.000Z')],[],now).queue.length,0));
test('mail selection applies the 72 hour window, the ledger, reviewed rows and the cap',()=>{
 const queue=[entry('Old','X','2026-11-02T11:59:00.000Z'),entry('Sent','X'),entry('Reviewed','X'),entry('Fresh','X')];
 assert.deepEqual(selectForMail(queue,[{company:'Sent',title:'X'}],[{company:'Reviewed',title:'X',decision:'reject'}],now).map(l=>l.company),['Fresh']);
 assert.equal(selectForMail(Array.from({length:30},(_,i)=>entry('C'+i,'X')),[],[],now).length,20);
});
test('oldest rows go first and Handshake leads within the same time',()=>{
 const queue=[entry('L','X'),entry('H','X',now,'Handshake'),entry('Older','X','2026-11-05T00:00:00.000Z')];
 assert.deepEqual(selectForMail(queue,[],[],now).map(l=>l.company),['Older','H','L']);
});
test('payload shortens long location lists',()=>assert.equal(toPayload({...entry('A','X'),locations:['a','b','c','d','e']}).location,'a; b; c +2 more'));

async function lane(records={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'platform-mail-')),runtime=path.join(dir,'rt'),root=path.join(dir,'root'),out=path.join(dir,'out');
 for(const d of [runtime,out,path.join(root,'.codex_tmp')])await fs.mkdir(d,{recursive:true});
 await fs.writeFile(path.join(root,'.codex_tmp/codex-direct-db-gmail-state.json'),JSON.stringify({records}));
 await fs.writeFile(path.join(runtime,QUEUE),JSON.stringify([entry('A','X')]));
 return {runtime,root,out};
}
const receipt=(out,body)=>fs.writeFile(path.join(out,'s-us-dispatch.json'),JSON.stringify(body));
test('reserve writes the ledger before the POST and never offers a row twice',async()=>{
 const l=await lane(),leads=await reservePlatformLeads({...l,now});
 assert.equal(leads.length,1);assert.equal((await readLedger(l.runtime))[0].status,'attempting');
 assert.equal(JSON.parse(await fs.readFile(path.join(l.out,PLAN),'utf8'))[0].firstSeen,'2026-11-05');
 assert.equal((await reservePlatformLeads({...l,out:await fs.mkdtemp(path.join(os.tmpdir(),'o-')),now})).length,0);
});
test('a row the DB already reviewed is not reserved',async()=>{
 const l=await lane({k:{company:'A',title:'X',decision:'approve'}});
 assert.equal((await reservePlatformLeads({...l,now})).length,0);
});
test('a confirmed mail marks the rows sent',async()=>{
 const l=await lane(),leads=await reservePlatformLeads({...l,now});await receipt(l.out,{phase:'responded',status:200,result:{alerts:{sent:1,platformLeadsSent:1}}});
 assert.deepEqual(await settlePlatformLeads({runtime:l.runtime,out:l.out,stamp:'s',leads}),{offered:1,sent:1,released:0});assert.equal((await readLedger(l.runtime))[0].status,'sent');
});
test('no POST releases the rows for the next run',async()=>{
 const l=await lane(),leads=await reservePlatformLeads({...l,now});
 assert.equal((await settlePlatformLeads({runtime:l.runtime,out:l.out,stamp:'s',leads})).released,1);assert.equal((await readLedger(l.runtime)).length,0);
});
test('a server without the field proves the rows were left out',async()=>{
 const l=await lane(),leads=await reservePlatformLeads({...l,now});await receipt(l.out,{phase:'responded',status:200,result:{alerts:{sent:1}}});
 assert.equal((await settlePlatformLeads({runtime:l.runtime,out:l.out,stamp:'s',leads})).released,1);
});
test('an unknown outcome keeps the rows reserved so they are never sent again',async()=>{
 const l=await lane(),leads=await reservePlatformLeads({...l,now});await receipt(l.out,{phase:'attempting'});
 assert.equal((await settlePlatformLeads({runtime:l.runtime,out:l.out,stamp:'s',leads})).uncertain,1);assert.equal((await readLedger(l.runtime))[0].status,'attempting');
});
