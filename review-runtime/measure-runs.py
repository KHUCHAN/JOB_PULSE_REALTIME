"""Metadata/JSON-only measurement; never reads the prohibited rollout or token."""
from pathlib import Path
import json,sqlite3,datetime
h=Path.home();r=h/'Library/Application Support/Job Pulse/review-runtime';today=datetime.datetime.now(datetime.timezone.utc).date().isoformat()
results=[]
for p in (r/'shadow-runs').glob('*/summary.json'):
 try:d=json.loads(p.read_text())
 except:continue
 results.append({k:d.get(k) for k in ['kind','runAt','status','llmTokens','posts','canonicalStateUnchanged','snapshotStateUnchanged','selectedIds']})
platform=[]
for p in (r/'platform-runs').glob('*/usage.json'):
 platform.append({'day':p.parent.name,'usage':json.loads(p.read_text())})
connection=sqlite3.connect(f'file:{h}/.codex/state_5.sqlite?mode=ro',uri=True)
thread=connection.execute('select updated_at,tokens_used from threads where id=?',('019fdff1-8d7f-7443-8f27-2b20a60164f9',)).fetchone()
output={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'shadowRuns':results,'platformUsage':platform,'legacyThreadMetadata':{'updatedAt':thread[0],'tokensUsed':thread[1]} if thread else None,'threeScheduledRunComparison':'pending; no old rollout read'}
(r/'TOKEN_MEASUREMENT.json').write_text(json.dumps(output,indent=2));print(json.dumps({'shadowRuns':len(results),'platformDays':len(platform),'threeScheduledRunComparison':output['threeScheduledRunComparison']}))
