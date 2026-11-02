"""One-time authorized pending-date patch; no network/review/state writes."""
from pathlib import Path
import json,hashlib,datetime,shutil,sys
r=Path.home()/'Library/Application Support/Job Pulse/review-runtime';project=Path(sys.argv[1]);a=json.loads((r/'archive.json').read_text());v=json.loads((r/'versions.json').read_text())
name='heartbeat-20261007T173045-tools.mjs';source=a['files'][name]['content'];uri=(r/'date-policy.mjs').as_uri()
old="  const date=r.rationale?.match(/Official date: (\\d{4}-\\d\\d-\\d\\d(?:T[^ ]+)?)/)?.[1]?.replace(/\\.$/,'');"
assert old in source
source=source.replace("import fs from 'node:fs/promises';",f"import fs from 'node:fs/promises';\nimport {{pendingEffectiveDate}} from '{uri}';")
source=source.replace(old,"  let date=pendingEffectiveDate(r);if(!date&&r.rationale?.includes('게시일 미표기 · 수집일 '))date=pendingEffectiveDate(r,await get({resource:'job',id:r.jobId}));")
transport='us-dispatch-20260930.mjs';body=a['files'][transport]['content'];oldpush="plan.pending.push({jobId:j.id,date,country:'United States'";assert oldpush in body
body=body.replace(oldpush,"plan.pending.push({jobId:j.id,date,dateBasis:dateFromOfficial(j,w?.startDate??ld?.datePosted??ld?.dateModified,e).basis,country:'United States'")
backup=r/('pending-policy-backup-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S'));backup.mkdir()
for f in ['archive.json','versions.json','date-policy.mjs']:shutil.copy2(r/f,backup/f)
for n,s in [(name,source),(transport,body)]:
 p=project/'.codex_tmp'/n;assert p.stat().st_size==a['files'][n]['bytes'];shutil.copy2(p,backup/n);p.write_text(s);stat=p.stat();a['files'][n].update(content=s,bytes=len(s.encode()),sha256=hashlib.sha256(s.encode()).hexdigest());key=str(p.relative_to(project));v[key].update(size=stat.st_size,mtimeMs=stat.st_mtime_ns/1e6)
shutil.copy2(Path(__file__).parent/'date-policy.mjs',r/'date-policy.mjs')
(r/'archive.json').write_text(json.dumps(a));(r/'versions.json').write_text(json.dumps(v));print(json.dumps({'patched':[name,transport],'backup':str(backup),'stateWrites':0,'posts':0}))
