"""Foreground only: stable original bytes -> immutable generation -> atomic pointer.
No token, POST, automation mutation, deletion, or reconstructed durable state.
"""
import argparse, hashlib, json, os, subprocess, sys, time, uuid
from pathlib import Path
BASE = Path.home()/'Library/Application Support/Job Pulse'
RUNTIME = BASE/'review-runtime'
ROOT = BASE/'runtime-root'
def sha(data): return hashlib.sha256(data).hexdigest()
def stable_read(p):
    if p.is_symlink(): raise RuntimeError('Symlink input denied: '+str(p))
    before=p.stat(); data=p.read_bytes(); after=p.stat()
    if len(data)!=before.st_size or (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):
        raise RuntimeError('Empty/changed input: '+str(p))
    if sha(data)!=sha(p.read_bytes()): raise RuntimeError('Source changed during hash verification: '+str(p))
    return data

def snapshot(heartbeat=None, live_source=False):
    project=ROOT if live_source else Path(json.loads((RUNTIME/'config.local.json').read_text())['canonicalProject'])
    if live_source and not (ROOT/'live-authorization.json').exists(): raise RuntimeError('Live source is not authorized')
    original=project/'.codex_tmp'; ROOT.mkdir(exist_ok=True)
    generation=ROOT/'snapshots'/('snapshot-'+str(time.time_ns())+'-'+uuid.uuid4().hex[:8])
    tmp=generation/'.codex_tmp';tmp.mkdir(parents=True)
    records=[]
    def save(relative,data,source,mtime=None):
        dest=generation/relative; dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_bytes(data)
        if sha(dest.read_bytes())!=sha(data): raise RuntimeError('Destination hash mismatch')
        if mtime is not None: os.utime(dest,(mtime,mtime))
        dest.chmod(0o444)
        records.append({'relative':str(relative),'source':str(source),'sha256':sha(data),'bytes':len(data)})
    archive=json.loads((RUNTIME/'archive.json').read_text())['files']
    versions=json.loads((RUNTIME/'versions.json').read_text())
    for name,row in archive.items():
        data=row['content'].encode()
        if sha(data)!=row['sha256'] or len(data)!=row['bytes']: raise RuntimeError('Archive mismatch: '+name)
        key='.codex_tmp/'+name; version=versions.get(key)
        if not version: raise RuntimeError('Missing version: '+name)
        observed=(original/name).stat()
        if observed.st_size!=version['size'] or abs(observed.st_mtime_ns/1e6-version['mtimeMs'])>1: raise RuntimeError('Original helper version changed: '+name)
        save(Path(key),data,'verified archive:'+name,version['mtimeMs']/1000)
    key='.codex_tmp/worktrees/repair-all-20260831/lib/resume-match.ts'
    save(Path(key),stable_read(RUNTIME/'resume-match.ts'),RUNTIME/'resume-match.ts',versions[key]['mtimeMs']/1000)
    save(Path('.codex_tmp/worktrees/repair-all-20260831/package.json'),b'{"type":"module"}', 'module resolver anchor')
    state=stable_read(original/'codex-direct-db-gmail-state.json')
    if not isinstance(json.loads(state).get('records'),dict): raise RuntimeError('Invalid canonical state')
    save(Path('.codex_tmp/codex-direct-db-gmail-state.json'),state,original/'codex-direct-db-gmail-state.json')
    files=list(original.glob('heartbeat-*-external-delivery-exclusion.review.json'))
    inbox=original/'review-inbox'; (tmp/'review-inbox').mkdir(exist_ok=True)
    files += [p for p in inbox.iterdir() if p.is_file() and not p.name.startswith('.') and p.suffix.lower() in ('.pdf','.docx','.json','.ndjson','.csv','.html')]
    for p in files: save(Path('.codex_tmp')/p.relative_to(original),stable_read(p),p)
    for name in ['undated-source-observations.json','community-lookup-checkpoints.json']:
        p=(ROOT/'review-runtime' if live_source else RUNTIME)/name
        if p.exists(): save(Path('review-runtime')/name,stable_read(p),p)
    ledger=project/'applications/ledger.csv' if live_source else project.parent/'applications/ledger.csv'
    save(Path('applications/ledger.csv'),stable_read(ledger),ledger)
    if heartbeat:
        if not __import__('re').fullmatch(r'heartbeat-\d{8}T\d{6}',heartbeat): raise RuntimeError('Exact heartbeat required')
        legacy=RUNTIME/'runs'/heartbeat
        # Preserve exact supporting gate inputs even when the run directory uses the new compact layout.
        for p in original.glob(heartbeat+'*.json'):
            p.read_bytes() # foreground hydration; stable_read still verifies the final bytes twice
            save(Path('legacy')/p.name,stable_read(p),p)
        for p in legacy.iterdir():
            if p.is_file() and p.suffix=='.json': save(Path('legacy')/p.name,stable_read(p),p)
    # Recheck the state at publication: never publish an inconsistent heartbeat.
    if sha(stable_read(original/'codex-direct-db-gmail-state.json'))!=sha(state): raise RuntimeError('Legacy writer changed state; retry after heartbeat')
    manifest={'createdAt':time.time(),'heartbeat':heartbeat,'project':str(generation),'files':records,'tokenCopied':False}
    save(Path('snapshot-manifest.json'),json.dumps(manifest,indent=2).encode(),'snapshot metadata')
    for directory,_,_ in os.walk(generation,topdown=False): Path(directory).chmod(0o555)
    link=ROOT/('snapshot-pointer-'+uuid.uuid4().hex);link.symlink_to(generation, target_is_directory=True)
    os.replace(link,ROOT/'current-snapshot')
    print(json.dumps({'status':'snapshot-published','project':str(generation),'files':len(records),'stateSha256':sha(state),'tokenCopied':False}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--heartbeat');p.add_argument('--latest-heartbeat',action='store_true');p.add_argument('--live-source',action='store_true');p.add_argument('--worker',action='store_true');a=p.parse_args()
    if a.latest_heartbeat:
        complete=[]
        for summary in (RUNTIME/'runs').glob('heartbeat-*/summary.json'):
            try:
                if json.loads(summary.read_text()).get('status')=='complete':complete.append(summary.parent.name)
            except (OSError,ValueError):pass
        if not complete:raise RuntimeError('No completed heartbeat evidence')
        a.heartbeat=max(complete)
    if a.worker: snapshot(a.heartbeat,a.live_source)
    else:
        cmd=[sys.executable,__file__,'--worker']+(['--heartbeat',a.heartbeat] if a.heartbeat else [])+(['--live-source'] if a.live_source else [])
        try: sys.exit(subprocess.run(cmd,timeout=45).returncode)
        except subprocess.TimeoutExpired: print(json.dumps({'status':'hold-snapshot-source-timeout','published':False,'tokenCopied':False}));sys.exit(1)
