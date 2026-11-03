import { it,expect } from 'vitest';import {platformCompanyKey,platformSource,officialPlatformJob} from './platform-discovery';
it('maps platform employer names onto catalog names',()=>{expect(platformCompanyKey('State Farm Insurance Companies')).toBe(platformCompanyKey('State Farm'));expect(platformCompanyKey('Siemens Digital Industries Software')).toBe(platformCompanyKey('Siemens US (Digital Industries)'));expect(platformCompanyKey('Siemens Healthineers')).not.toBe(platformCompanyKey('Siemens US (Digital Industries)'));});
const source={id:'acme',company:'Acme Inc.',postingUrl:'https://jobs.acme.com/search',adapter:'custom' as const};
const candidate={company:'Acme',title:'Data Science Intern',location:'Houston TX',platform:'Simplify',platformUrl:'https://github.com/SimplifyJobs/Summer2027-Internships',displayDate:'2026-11-02',officialUrl:'https://jobs.acme.com/job/123'};
const html=(patch={})=>'<script type="application/ld+json">'+JSON.stringify({'@type':'JobPosting',title:candidate.title,identifier:{value:'R123'},description:'Develop machine learning and Python data science systems. Currently enrolled students may apply. This internship is based in Houston.',jobLocation:{address:{addressCountry:'US',addressRegion:'TX',addressLocality:'Houston'}},...patch})+'</script>';
it('matches code-owned company/origin and never trusts platform date as official date',()=>{expect(platformSource(candidate,[source])).toEqual(source);expect(officialPlatformJob(candidate,source,html())?.publishedAt).toBeNull();expect(officialPlatformJob(candidate,source,html({datePosted:'2026-01-01'}))?.publishedAt).toBe('2026-01-01T00:00:00.000Z');});
it('rejects wrong employer, landing-page HTML, missing official US evidence and malformed dates',()=>{expect(platformSource({...candidate,officialUrl:'https://jobs.attacker.com/123'},[source])).toBeNull();expect(officialPlatformJob(candidate,source,'<title>Search jobs</title>')).toBeNull();expect(officialPlatformJob(candidate,source,html({jobLocation:{address:{addressCountry:'CA'}}}))).toBeNull();expect(officialPlatformJob(candidate,source,html({datePosted:'yesterday'}))).toBeNull();});

it('never converts a platform display date or a challenge into new official posting evidence',()=>{expect(officialPlatformJob(candidate,source,'<title>Just a moment...</title>'+html())).toBeNull();});
it('accepts a Workday tenant named exactly after the employer, and nothing looser',()=>{
 const workday=(company:string,host:string)=>({...candidate,company,officialUrl:`https://${host}/en-US/careers/job/X_R1`});
 const danaher={...source,id:'danaher',company:'Danaher Corporation',postingUrl:'https://jobs.danaher.com/search'};
 expect(platformSource(workday('Danaher Corporation','danaher.wd1.myworkdayjobs.com'),[danaher])).toEqual(danaher);
 expect(platformSource(workday('Danaher Corporation','danaherlabs.wd1.myworkdayjobs.com'),[danaher])).toBeNull();
 expect(platformSource(workday('Danaher Corporation','danaher.myworkdayjobs.com.attacker.com'),[danaher])).toBeNull();
 expect(platformSource(workday('Danaher Corporation','danaher.wd1.myworkdayjobs.com'),[danaher,{...danaher,id:'second',postingUrl:'https://careers.danaher.com/'}])).toBeNull();
 expect(platformSource(workday('Other Co','danaher.wd1.myworkdayjobs.com'),[danaher])).toBeNull();
 expect(platformSource(workday('Pacific Life','pacific-life.wd1.myworkdayjobs.com'),[{...danaher,id:'pl',company:'Pacific Life',postingUrl:'https://careers.pacificlife.com/'}])?.id).toBe('pl');
});
