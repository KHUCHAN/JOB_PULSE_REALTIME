import test from 'node:test';import assert from 'node:assert/strict';
import {parseLinkedinCards,selectLinkedinLeads,pendingUrlSearches,applyFound,markTried,urlSearchKey} from './platform-policy.mjs';
const card=(company,title,loc='Irvine, CA',slug='x-1')=>`<li><div class="base-card relative w-full"><a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/${slug}?position=1&trk=a"></a><h3 class="base-search-card__title">\n ${title} </h3><h4 class="base-search-card__subtitle"><a href="#">${company}</a></h4><span class="job-search-card__location">${loc}</span><time class="job-search-card__listdate" datetime="2026-11-02">1 day ago</time></div></li>`;
test('reads a public LinkedIn card and drops tracking from its link',()=>assert.deepEqual(parseLinkedinCards('<ul>'+card('AT&amp;T','Data Intern')+'</ul>'),[{company:'AT&T',title:'Data Intern',location:'Irvine, CA',displayDate:'2026-11-02',platformUrl:'https://www.linkedin.com/jobs/view/x-1'}]));
test('a page with no job cards yields nothing',()=>assert.deepEqual(parseLinkedinCards('<html>Sign in</html>'),[]));
test('keeps priority intern rows once',()=>{const rows=[['Acme','Data Science Intern'],['Acme Inc','Data Science Intern'],['Acme','Marketing Intern'],['Acme','Data Scientist']].map(([company,title])=>({company,title}));assert.deepEqual(selectLinkedinLeads(rows).map(r=>r.title),['Data Science Intern']);});
const sources=[{company:'Danaher Corporation',postingUrl:'https://www.jobs.danaher.com/x'}];
const row=(company,title,officialUrl='')=>({company,title,location:'Logan, UT',officialUrl});
test('searches only unresolved rows of known employers, bounded',()=>{
 const rows=[row('Danaher Corporation','A'),row('Danaher Corporation','B','https://jobs.danaher.com/b'),row('Unknown Co','C'),row('Danaher Corporation','D'),row('Danaher Corporation','E'),row('Danaher Corporation','F'),row('Danaher Corporation','G')];
 const got=pendingUrlSearches(rows,{},sources);assert.deepEqual(got.map(p=>p.title),['A','D','E','F']);assert.deepEqual(got.map(p=>p.id),[0,1,2,3]);assert.deepEqual(got[0].sourceHosts,['jobs.danaher.com']);
});
test('a row already searched is not searched again',()=>{const rows=[row('Danaher Corporation','A')];assert.deepEqual(pendingUrlSearches(rows,{[urlSearchKey(rows[0])]:'2026-11-03'},sources),[]);});
test('nothing to search means an empty list',()=>assert.deepEqual(pendingUrlSearches([],{},sources),[]));
test('applies only valid answers to the row that was asked about',()=>{
 const rows=[row('Danaher Corporation','A'),row('Danaher Corporation','D')],pending=pendingUrlSearches(rows,{},sources);
 assert.equal(applyFound(rows,pending,[{id:0,officialUrl:'https://jobs.danaher.com/a'},{id:1,officialUrl:'http://jobs.danaher.com/d'},{id:9,officialUrl:'https://evil.example/x'}]),1);
 assert.equal(rows[0].officialUrl,'https://jobs.danaher.com/a');assert.equal(rows[1].officialUrl,'');
});
test('marks searched rows and forgets old ones',()=>{const next=markTried({old:'2026-10-01',recent:'2026-11-01'},[{company:'Acme',title:'Data Intern'}],'2026-11-03');assert.deepEqual(Object.keys(next).sort(),['acme|dataintern','recent']);});
