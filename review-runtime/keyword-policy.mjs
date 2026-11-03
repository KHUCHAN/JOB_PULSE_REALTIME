import fs from 'node:fs/promises';import ts from 'typescript';
import {postingText,sentences} from './caveats.mjs';
const source=await fs.readFile(new URL('../lib/resume-match.ts',import.meta.url),'utf8');
const {normalize,roleEvidence,skillEvidence,domainEvidence}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source+'\nexport {normalize,roleEvidence,skillEvidence,domainEvidence};',{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
// Fit signals only: caveat extraction always receives the untouched posting.
// Employer job-family examples and "embedding new policies" say nothing about the role itself.
export function fitSignalText(body){
 const text=postingText(body).split(/\b(?:Company Overview|AI and Biometric Usage|Candidate AI Usage Policy|Avoid and Report Recruitment Scams|As part of the hiring process, we will ask you to complete an identity verification|Learn more on how to protect yourself from fraudulent job postings)\b/i)[0];
 return sentences(text).filter(t=>{
  const recruiting=/fraudulent recruit|recruitment fraud|fraud alert:|fraud-protection|job posting fraud|fraudulent job postings|^(?:AI alert: Candidates|Automated Processing and AI|We use automated processing|Please note that .* uses artificial intelligence|Identity Statement)/i.test(t);
  return !recruiting;
 }).join('\n').replace(/\borgani[sz]ations?\s*\(\s*(?:e\.g\.,?|such as|including)\s*(?:[^,)\n]*\bEngineering\s*,\s*){2,}[^)\n]*\)/gi,' ').replace(/\bembedding\s+(?=(?:(?:new|best|good|sound|strong|a|the|our)\s+)?(?:polic|procedur|control|cultur|risk|values?\b|practices?\b))/gi,'').replace(/Master of Laws\s*\(\s*LLM\s*\)/gi,'Master of Laws');
}
export function keywordLabels(row,body){const clean=fitSignalText(body),input={...row,summary:null,responsibilities:null,qualifications:null,description:clean,skills:[],jobFamily:null,jobFunction:null};const hay=normalize(row.title+' '+clean);return [...new Set([roleEvidence(normalize(row.title))??roleEvidence(hay),...skillEvidence(input),domainEvidence(hay)].filter(Boolean).map(x=>x.label))];}
