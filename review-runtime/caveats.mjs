import {JSDOM} from 'jsdom';
export function postingText(html) {
 let h=String(html??'');
 for(let i=0;i<4&&/&(lt|gt|amp);/.test(h);i++)h=new JSDOM('<textarea>'+h+'</textarea>').window.document.querySelector('textarea').value;
 const doc=new JSDOM(h.replace(/<\/(?:p|li|div|h[1-6])>|<br\s*\/?>/gi,'\n')).window.document;
 doc.querySelectorAll('script,style,noscript').forEach(x=>x.remove());
 return doc.body.textContent.replace(/[^\S\n]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
}
export function sentences(text) {
 // Slice source spans: abbreviations retain every internal byte, never crossing a newline.
 return String(text??'').split(/[\r\n]+/).flatMap(line=>{
  const out=[];let start=0;
  for(const m of line.matchAll(/(?=\s*[·•]\s)|(?<=[.!?])\s+(?=[A-Z*•-])|(?<=[a-z0-9)])\s+(?=Must (?:be|have)\b)/g)){
   if(m[0]&&/(?:\bU\.S\.|\bPh\.|\bB\.|\bM\.|\be\.g\.|\bi\.e\.)$/.test(line.slice(start,m.index)))continue;
   out.push(line.slice(start,m.index).trim());start=m.index+m[0].length;
  }
  out.push(line.slice(start).trim());return out.filter(Boolean);
 });
}
// These restrictions survive both boilerplate filtering and rationale budgeting.
export const protectedCaveat=t=>/\bvisa\b|sponsorship|\bsponsor(?:ed|ing)?\b.*(?:applicants?|candidates?|employment)|work authoriz|authorized to work|legally authoriz|legal authoriz|authorization to work|eligible to work|right to work|immigration|\b[FCJH]-?1\b|\bCPT\b|\bOPT\b|export licen|citizen|U\.S\. Person|clearance|matriculat|graduat|class of|rising|sophomore|junior (?:year|standing|level)|senior (?:year|standing|level)|freshm[ae]n|year of (?:study|college)|academic (?:year|standing)|continuing education|preferred majors?\s*:|majoring|technical major|working towards?|pursuing a (?:BS|BA|MS|MA)\b|enroll|degree|bachelor|undergrad|master[’'s]|masters|doctoral|doctorate|ph\.?\s?d|college|university|high school/i.test(t);
export function caveatClass(t) {
 if(/\bvisa\b|sponsor|work authoriz|authorized to work|legally authoriz|legal authoriz|authorization to work|eligible to work|right to work|immigration|\b[FCJH]-?1\b|\bCPT\b|\bOPT\b|export licen/i.test(t))return 'authorization';
 if(/citizen|U\.S\. Person|clearance/i.test(t))return 'citizenship/clearance';
 if(/(?:based|location).*office|on[ -]?site|hybrid|in[ -]office|\boffice\b.*(?:days|week|based)|(?:days|week).*\boffice\b|commut|relocat|resid(?:e|ing)|50-mile/i.test(t))return 'attendance';
 if(/coursework|course work|prerequisite|completed an? .*(?:introduction|course)/i.test(t))return 'coursework';
 if(/matriculat|graduat|class of|rising|(?:sophomore|junior|senior|freshman|freshmen).*(?:year|standing|level|student)|year of (?:study|college)|academic year/i.test(t))return 'study timing';
 if(/continuing education|preferred majors?\s*:|majoring|technical major|working toward|working towards|pursuing a (?:BS|BA|MS|MA)\b|enroll|degree|bachelor|undergrad|master[’'s]|masters|doctoral|doctorate|ph\.?\s?d|college|university|high school/i.test(t))return 'degree/enrollment';
 if(/\bGPA\b|grade point|\btranscripts?\b|minimum requirements|preferred qualifications|drivers? licen[cs]e|HAZWOPER/i.test(t))return 'prerequisite';
 if(/(?:internship|interns?|co.op|program|role).*(?:duration|start date|full.time|part.time|weeks?|months?|June|August)|availability (?:to|for)|hours?\s*\/\s*week|\bin person\b|\btravel\b|relocat|field of study|duration and start dates/i.test(t))return 'attendance/timing';
 if(/^(?:[·•*\-]\s*)?(?:Candidates|Applicants|Must|Required|Eligibility|Strong foundation|Are working towards)\b/i.test(t))return 'application prerequisite';
 if(/full.time internship|internship.*(?:full.time|part.time)|interns.*embedded|primary location/i.test(t))return 'attendance/timing';
 return null;
}
export function extractCaveats(text) {
 const pieces=sentences(text),out=[];
 for(let i=0;i<pieces.length;i++){
  let t=pieces[i];
  // Equal-opportunity text names citizenship without restricting anyone.
  if(/\b(?:qualified applicants|consideration for employment)\b.*without regard to/i.test(t))continue;
  if(!protectedCaveat(t)&&(/caf[eé]|dining options|fitness cent(?:er|re)|^(?:[·•*\-]\s*)?(?:Create|Analyze|Build|Develop|Support|Maintain|Design|Fix|Coordinate|Present|Assist)\b/i.test(t)))continue;
  if(!protectedCaveat(t)&&(/privacy|accommodation|\b(?:benefits?|privileges|travel credits)\b|equal (?:employment )?opportunity|without regard to|all personnel actions/i.test(t)||/^#\S+$/.test(t)||/^(?:[·•*\-]\s*)?(?:required|preferred|qualifications|requirements|eligibility|minimum requirements|preferred qualifications|required qualifications)\s*:?$/i.test(t)))continue;
  if(!caveatClass(t))continue;
  if(/^PREFERRED MAJORS?:\s*$/i.test(t)){
   const start=text.indexOf(t);let end=start+t.length;
   while(pieces[i+1]&&!/:\s*$/.test(pieces[i+1])&&!/[.!?]$/.test(pieces[i+1])){
    const next=pieces[i+1],at=text.indexOf(next,end);if(at<0||!/^[\s]*$/.test(text.slice(end,at)))break;
    end=at+next.length;i++;
   }
   out.push(text.slice(start,end));continue;
  }
  if(/:\s*$/.test(t)&&pieces[i+1]&&pieces[i+1].length<240){const next=pieces[i+1];if(text.includes(t+' '+next)){t+=' '+next;i++;}else if(text.includes(t+'\n'+next)){t+='\n'+next;i++;}}
  out.push(t);
 }
 return [...new Set(out)];
}
export const storedCaveats=rationale=>(rationale?.split('Application caveats:')[1]??'').split(' | ').flatMap(sentences).map(s=>s.trim()).filter(Boolean);
