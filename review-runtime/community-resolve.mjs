import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
const runtime=process.env.JOB_PULSE_RUNTIME??path.resolve('..','review-runtime');
const {parseListings,parseMarkdown,companyKey,norm,canonical}=await import(pathToFileURL(path.join(runtime,'community-discovery.mjs')));
const input=process.argv[2],data=JSON.parse(await fs.readFile(input,'utf8')),observations=[],rows=[];
for(const [name,url,type] of [
 ['Simplify/PittCSC','https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json','json'],
 ['Understudy','https://raw.githubusercontent.com/Keugene11/Summer-2027-Tech-Internships/main/.github/scripts/listings.json','json'],
 ['SpeedyApply','https://raw.githubusercontent.com/speedyapply/2027-AI-College-Jobs/main/README.md','md'],
 ['Zapply','https://raw.githubusercontent.com/zapplyjobs/awesome-ml-internships-2027/main/README.md','md']]){
 try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);const body=await r.text(),parsed=type==='json'?parseListings(JSON.parse(body),name):parseMarkdown(body,name);rows.push(...parsed);observations.push({name,status:'checked',rows:parsed.length,url});}catch(e){observations.push({name,status:'unavailable',reason:e.message,url});}
}
let resolved=0;
for(const candidate of data.candidates.filter(c=>!c.officialUrl)){
 const matches=rows.filter(r=>companyKey(r.company)===companyKey(candidate.company)&&norm(r.title)===norm(candidate.title));
 const urls=[...new Set(matches.map(r=>canonical(r.url)))];
 if(urls.length===1){candidate.officialUrl=urls[0];resolved++;}
}
await fs.writeFile(path.join(path.dirname(input),'resolved-candidates.json'),JSON.stringify(data,null,2));await fs.writeFile(path.join(path.dirname(input),'community-resolution.json'),JSON.stringify({observations,resolved,officialDatesNotEstablished:true},null,2));
console.log(JSON.stringify({resolved,observations}));
