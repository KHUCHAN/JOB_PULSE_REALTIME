import {JSDOM} from 'jsdom';
export function postingText(html) {
 let h=String(html??'');
 for(let i=0;i<4&&/&(lt|gt|amp);/.test(h);i++)h=new JSDOM('<textarea>'+h+'</textarea>').window.document.querySelector('textarea').value;
 const doc=new JSDOM(h.replace(/<\/(?:p|li|div|h[1-6])>|<br\s*\/?>/gi,'\n')).window.document;
 doc.querySelectorAll('script,style,noscript').forEach(x=>x.remove());
 return doc.body.textContent.replace(/[^\S\n]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
}
export function sentences(text) {
 // Protect common abbreviations while preserving every original byte in quotes.
 return String(text??'').split(/\n+|(?=\s*[·•]\s)|(?<=[.!?])\s+(?=[A-Z*•-])/).map(x=>x.trim()).filter(Boolean).reduce((out,s)=>{
  if(out.length&&/(?:\bU\.S\.|\bPh\.|\bB\.|\bM\.|\be\.g\.|\bi\.e\.)$/.test(out.at(-1)))out[out.length-1]+=' '+s;else out.push(s);return out;
 },[]);
}
export function caveatClass(t) {
 if(/sponsor|work authoriz|authorized to work|legally authoriz|eligible to work|right to work|immigration|\b[FCJH]-?1\b|\bCPT\b|\bOPT\b|export licen/i.test(t))return 'authorization';
 if(/citizen|U\.S\. Person|clearance/i.test(t))return 'citizenship/clearance';
 if(/(?:based|location).*office|on[ -]?site|hybrid|in[ -]office|\boffice\b.*(?:days|week|based)|(?:days|week).*\boffice\b|commut|relocat|resid(?:e|ing)|50-mile/i.test(t))return 'attendance';
 if(/coursework|course work|prerequisite|completed an? .*(?:introduction|course)/i.test(t))return 'coursework';
 if(/matriculat|graduat|class of|rising|sophomore|junior|senior|freshman|freshmen|year of (?:study|college)|academic year/i.test(t))return 'study timing';
 if(/continuing education|majoring|technical major|working toward|working towards|pursuing a (?:BS|BA|MS|MA)\b|enroll|degree|bachelor|undergrad|master[’'s]|masters|doctoral|doctorate|ph\.?d|college|university|high school/i.test(t))return 'degree/enrollment';
 if(/\bGPA\b|grade point|\btranscripts?\b|minimum requirements|preferred qualifications|drivers? licen[cs]e|HAZWOPER/i.test(t))return 'prerequisite';
 if(/(?:internship|interns?|co.op|program|role).*(?:duration|start date|full.time|part.time|weeks?|months?|June|August)|availability|hours?\s*\/\s*week|\bin person\b|\btravel\b|relocat|field of study|duration and start dates/i.test(t))return 'attendance/timing';
 if(/^[·•]|^(?:Candidates|Applicants|Must|Required|Eligibility|Strong foundation|Are working towards)\b/i.test(t))return 'application prerequisite';
 if(/full.time internship|internship.*(?:full.time|part.time)|interns.*embedded|primary location/i.test(t))return 'attendance/timing';
 return null;
}
export function extractCaveats(text) {
 const pieces=sentences(text),out=[];
 for(let i=0;i<pieces.length;i++){
  let t=pieces[i];
  if(/privacy|accommodation/i.test(t))continue;
  if(!caveatClass(t))continue;
  if(/:\s*$/.test(t)&&pieces[i+1]&&pieces[i+1].length<240){const next=pieces[i+1];if(text.includes(t+' '+next)){t+=' '+next;i++;}else if(text.includes(t+'\n'+next)){t+='\n'+next;i++;}}
  out.push(t);
 }
 return [...new Set(out)];
}
export const storedCaveats=rationale=>(rationale?.split('Application caveats:')[1]??'').split(' | ').flatMap(sentences).map(s=>s.trim()).filter(Boolean);
