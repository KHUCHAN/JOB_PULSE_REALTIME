"""Measure only; no deletion, compression, retention or state writes."""
import json
from pathlib import Path
base=Path.home()/'Library/Application Support/Job Pulse';runtime=base/'review-runtime'
snapshot=(base/'runtime-root/current-snapshot').resolve();manifest=json.loads((snapshot/'snapshot-manifest.json').read_text())
# A live-source generation does not mirror legacy heartbeat comparison files.
entries=[x for x in manifest['files'] if not x['relative'].startswith('legacy/')]
snapshot_bytes=sum(x['bytes'] for x in entries)+(snapshot/'snapshot-manifest.json').stat().st_size
runs=[]
for p in sorted((runtime/'shadow-runs').glob('shadow-heartbeat-*/summary.json'),reverse=True):
 s=json.loads(p.read_text())
 if s.get('status')!='completed-shadow' or not any(x['name']=='inbox' for x in s['stages']):continue
 files=[x for x in p.parent.rglob('*') if x.is_file()];raw=sum(x.stat().st_size for x in files)
 runs.append({'run':str(p.parent),'files':len(files),'runEvidenceBytes':raw,'estimatedSnapshotBytes':snapshot_bytes,'measuredPolicyBytesPerRun':raw+snapshot_bytes,'actualLiveRun':False,'transportReceiptBytes':'unmeasured; no POST authorized'})
 if len(runs)==3:break
print(json.dumps({'snapshotMeasurement':'manifest inventory, excluding legacy/*; current manifest-size overhead used as estimate','runs':runs},indent=2))
