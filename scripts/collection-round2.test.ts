import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {crawlSource,coastCentralJobsFromHtml} from '../lib/crawler';
const pepsi={id:'p5-0699-pepsico',company:'PepsiCo',postingUrl:'https://www.pepsicojobs.com/main/jobs',adapter:'custom' as const};
it('retains only US PepsiCo records and never closes inventory from a country-contaminated feed',async()=>{
 const requests:string[]=[];const jobs=[{data:{req_id:'1',slug:'1',title:'Data Science Intern',country:'United States'}},{data:{req_id:'2',slug:'2',title:'Intern',country:'Spain'}}];
 const result=await crawlSource(pepsi,async input=>{requests.push(String(input));return Response.json({totalCount:2,jobs});},new Date());
 expect(result).toMatchObject({status:'succeeded',completeListing:false});expect(result.jobs.map(j=>j.externalId)).toEqual(['1']);
 expect(requests.every(u=>new URL(u).hostname==='www.pepsicojobs.com')).toBe(true);
});
it('stops PepsiCo at an official challenge without another host',async()=>{
 const hosts:string[]=[];const result=await crawlSource(pepsi,async input=>{hosts.push(new URL(String(input)).hostname);return new Response('challenge',{status:403});},new Date());
 expect(result).toMatchObject({status:'blocked',completeListing:false,jobs:[]});expect(new Set(hosts)).toEqual(new Set(['www.pepsicojobs.com']));
});
it('parses the observed Coast Central section, short PDF labels and official spelling error',()=>{
 const source={id:'p2-0034-coast-central-cu',company:'Coast Central Credit Union',postingUrl:'https://www.coastccu.org/community/careers/',adapter:'custom' as const};
 const jobs=coastCentralJobsFromHtml(readFileSync('scripts/fixtures/coast-central-20261102.html','utf8'),source);
 expect(jobs).toHaveLength(8);expect(jobs!.some(j=>j.title==='Member Services Specialist')).toBe(true);
 expect(jobs!.every(j=>new URL(j.officialUrl).hostname==='www.coastccu.org')).toBe(true);
});
it('accepts only the pinned Royal Business Bank canonical redirect',async()=>{
 const html='<div class="c-accordion__item js-acc-item"><button class="c-accordion__title">Analyst Intern</button><div class="location">Los Angeles, CA</div><div class="is-wysiwyg">Data analysis internship.</div><div class="c-block__btn"><a href="mailto:careers@example.com">Apply</a></div></div>';
 const source={id:'p2-0058-royal-business-bank',company:'Royal Business Bank',postingUrl:'https://www.royalbusinessbankusa.com/careers',adapter:'custom' as const};
 for(const [url,okay] of [['https://royalbusinessbankusa.com/careers/',true],['https://evil.example/careers/',false],['https://royalbusinessbankusa.com/other/',false]] as const){
  const response=new Response(html);Object.defineProperty(response,'url',{value:url});
  const result=await crawlSource(source,async()=>response,new Date());expect(result.status).toBe(okay?'succeeded':'failed');
 }
});
