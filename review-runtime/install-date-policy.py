"""Install explicit policy patches in hash-verified helpers; preserves original code backups and state.
Run only after verifying the existing automation is idle. No network or POST.
"""
from pathlib import Path
import json,hashlib,shutil,datetime
runtime=Path.home()/'Library/Application Support/Job Pulse/review-runtime'
archive=json.loads((runtime/'archive.json').read_text());versions=json.loads((runtime/'versions.json').read_text())
# Locate the canonical project from the existing version map; supplied explicitly.
import sys
project=Path(sys.argv[1]); backup=runtime/('policy-backup-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S'))
backup.mkdir()
for name in ['archive.json','versions.json']:
 shutil.copy2(runtime/name,backup/name)
for name in ['date-policy.mjs','source-guard.mjs']:
 shutil.copy2(Path(__file__).parent/name,runtime/name)
patches={}
def patch(name,old,new):
 s=patches.get(name,archive['files'][name]['content'])
 assert old in s,(name,old)
 patches[name]=s.replace(old,new)
uri=(runtime/'date-policy.mjs').as_uri()
scan='heartbeat-20260910T073856-scan.mjs'
patch(scan,"resource:'jobs'","resource:'reviewJobs'")
patch(scan,'Date.parse(j.publishedAt)<Date.parse(out.cutoff)','Date.parse(j.publishedAt??j.firstSeenAt)<Date.parse(out.cutoff)')
patch(scan,'out.mail=await get',f"await (await import('{(runtime/'source-guard.mjs').as_uri()}')).guardScan(out,await get({{resource:'sources'}}),{json.dumps(str(runtime))});\nout.mail=await get")
prep='heartbeat-20260910T073856-prepare.mjs'
patch(prep,"import fs from 'node:fs/promises';",f"import fs from 'node:fs/promises';\nimport {{effectiveDate,dateFromOfficial}} from '{uri}';")
patch(prep,'if(!title||!date||!desc)','if(!title||!desc)')
patch(prep,'w?.startDate??ld?.datePosted,dateMs',"dateFromOfficial(j,w?.startDate??ld?.datePosted??ld?.dateModified,e).date,dateMs")
patch(prep,"date?`Official date: ${date}`:'Official publication date unverifiable'","dateFromOfficial(j,w?.startDate??ld?.datePosted??ld?.dateModified,e).label??(date?`Official date: ${date}`:'Official publication date unverifiable')")
patch(prep,'country:verifiedCountry,date,decision','country:verifiedCountry,date,dateBasis:dateFromOfficial(j,w?.startDate??ld?.datePosted??ld?.dateModified,e).basis,decision')
transport='us-dispatch-20260930.mjs'
patch(transport,"import fs from 'node:fs/promises';",f"import fs from 'node:fs/promises';\nimport {{effectiveDate,dateFromOfficial}} from '{uri}';")
patch(transport,'title&&datePosted&&description?','title&&description?')
patch(transport,'w?.startDate??ld?.datePosted,locations',"dateFromOfficial(j,w?.startDate??ld?.datePosted??ld?.dateModified,e).date,locations")
patch(transport,'identities.add(identity);identities.add(fp(j));selected.push(j.id);',"if(candidate.dateBasis==='firstSeenAt'){const fresh=dateFromOfficial(j,null,{status:live.status,html});if(fresh.basis!=='firstSeenAt'||!isRecentOfficialDate(fresh.date,new Date().toISOString())){excluded.push({id:j.id,reason:'Live absence/date changed'});continue;}} identities.add(identity);identities.add(fp(j));selected.push(j.id);")
stage=runtime/'stage-template.mjs'
shutil.copy2(stage,backup/stage.name)
stagecode=stage.read_text()
needle="} else if(mode==='prepare-complete') {"
assert needle in stagecode
stagecode=stagecode.replace(needle,needle+f"\n const scan=JSON.parse(await fs.readFile(new URL(stamp+'.json',root))); const response=await fetch('https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse?resource=sources'); assert(response.ok); await (await import('{(runtime/'source-guard.mjs').as_uri()}')).guardScan(scan,await response.json(),{json.dumps(str(runtime))}); await fs.writeFile(new URL(stamp+'.json',root),JSON.stringify(scan));")
stage.write_text(stagecode)
# Preserve code identity checks and refresh only the deliberately changed versions.
for name,s in patches.items():
 p=project/'.codex_tmp'/name;old=archive['files'][name]
 assert p.stat().st_size==old['bytes'],name
 shutil.copy2(p,backup/name)
 p.write_text(s)
 st=p.stat();archive['files'][name]={**old,'content':s,'bytes':len(s.encode()),'sha256':hashlib.sha256(s.encode()).hexdigest()}
 key=str(p.relative_to(project));versions[key]={**versions[key],'size':st.st_size,'mtimeMs':st.st_mtime_ns/1e6}
(runtime/'archive.json').write_text(json.dumps(archive))
(runtime/'versions.json').write_text(json.dumps(versions))
print(json.dumps({'patched':list(patches),'backup':str(backup),'stateModified':False}))
