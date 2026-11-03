import test from 'node:test';import assert from 'node:assert/strict';
import {parseCard,selectLeads,splitByInventory,mergeLeads,updateSourceGaps} from './handshake-policy.mjs';
const row=(id,company,title,meta,location,date='New')=>({id,lines:[company,title,meta,location,'∙',date]});
test('parses a card',()=>{const c=parseCard(row('1','Amazon','SDE Intern','$50/hr · Internship','Irvine, CA + 8','3d ago'));assert.equal(c.location,'Irvine, CA + 8');assert.equal(c.displayDate,'3d ago');assert.equal(c.platformUrl,'https://usc.joinhandshake.com/job-search/1');});
test('reads the location past an extra label line',()=>{const c=parseCard({id:'2',lines:['Bloomberg','Data Intern','Internship','USC collection','New York, NY','∙','New']});assert.equal(c.location,'New York, NY');assert.equal(c.displayDate,'New');});
test('keeps recent US intern rows in the priority families only',()=>{
 const got=selectLeads([
  row('1','Amazon','Software Development Engineer Intern','$109K/yr · Internship','Irvine, CA + 8'),
  row('2','Amazon','Software Development Engineer Intern','$109K/yr · Internship','Irvine, CA + 8'),
  row('3','NYU Langone Health','Associate, Research Data','Full-time','Mineola, NY'),
  row('4','Shanghai Sixie','Machine Learning Infrastructure Intern','Full-time',"Shanghai, People's Republic of China"),
  row('5','Envoy Air','College Intern - Ground Support Equipment','Internship','Irving, TX'),
  row('6','Brain Co.','Machine Learning Engineer Intern','Internship','San Francisco, CA','5d ago'),
  row('7','Firework','Data Engineer Intern','Internship','San Mateo, CA','3d ago')]);
 assert.deepEqual(got.map(g=>g.id),['1','7']);
});
test('splits leads by source inventory',()=>{const r=splitByInventory([{company:'Amazon Inc.'},{company:'Brain Co.'}],[{company:'Amazon'}]);assert.equal(r.inInventory.length,1);assert.equal(r.notInInventory.length,1);});
test('merge reports the real status, dedupes and respects the cap',()=>{
 const data={platforms:[{name:'Handshake',status:'unavailable'}],candidates:[{company:'Amazon',title:'SDE Intern'}]};
 const gaps=[{company:'Amazon, Inc',title:'SDE Intern'},{company:'Adobe',title:'Data Intern',location:'San Jose, CA',platformUrl:'https://x/1',displayDate:'New'},{company:'IBM',title:'AI Intern'}];
 const m=mergeLeads(data,{status:'checked',unique:9,gaps},2);
 assert.equal(m.platforms.at(-1).status,'checked');assert.equal(m.platforms.filter(p=>p.name==='Handshake').length,1);
 assert.deepEqual(m.candidates.map(c=>c.company),['Amazon','Adobe']);assert.equal(m.candidates[1].officialUrl,'');
});
test('unavailable report leaves candidates alone and keeps the reason',()=>{const m=mergeLeads({platforms:[],candidates:[]},{status:'unavailable',reason:'Chrome is not running'});assert.equal(m.platforms[0].reason,'Chrome is not running');assert.equal(m.candidates.length,0);});
test('source gap ledger counts days once and drops employers added to the catalog',()=>{
 const rows=[{company:'Credit One Bank',title:'A'},{company:'Credit One Bank',title:'B'},{company:'AMP Beauty',title:'C'}];
 let l=updateSourceGaps({},rows,'2026-11-03',[]);assert.equal(l.creditonebank.days,1);assert.deepEqual(l.creditonebank.titles,['A','B']);
 l=updateSourceGaps(l,rows,'2026-11-03',[]);assert.equal(l.creditonebank.days,1);
 l=updateSourceGaps(l,rows.slice(0,1),'2026-11-04',[{company:'AMP Beauty'}]);assert.equal(l.creditonebank.days,2);assert.equal(l.creditonebank.firstSeen,'2026-11-03');assert.equal(l.ampbeauty,undefined);
});
