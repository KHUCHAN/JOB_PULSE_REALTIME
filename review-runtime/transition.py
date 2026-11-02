"""Cutover/rollback preparation. Only --dry-run is exercised in maintenance.
Execution requires separate supervisor go and verified secondary coverage.
"""
import argparse, fcntl, hashlib, json, os, plistlib, shutil, sqlite3, subprocess, sys, time, tomllib
from pathlib import Path
BASE=Path.home()/'Library/Application Support/Job Pulse';RUNTIME=BASE/'review-runtime';ROOT=BASE/'runtime-root';REPO=BASE/'repo'
ID='job-pulse-2-hour-crawl';DBS=[Path.home()/'.codex/sqlite'/n for n in ['codex.db','codex-dev.db']]
TOML=Path.home()/'.codex/automations'/ID/'automation.toml';PLIST=Path.home()/'Library/LaunchAgents/com.jobpulse.review-live.plist'
UID=str(os.getuid());LABEL='com.jobpulse.review-live'
def digest(data):return hashlib.sha256(data).hexdigest()
def rows():
    result=[]
    for db in DBS:
        with sqlite3.connect(f'file:{db}?mode=ro',uri=True) as c:
            c.row_factory=sqlite3.Row;r=c.execute('select * from automations where id=?',(ID,)).fetchone()
            if not r:raise RuntimeError('Automation missing: '+str(db))
            result.append(dict(r))
    if any(any(r[k]!=result[0][k] for k in ['status','prompt','updated_at','target_thread_id']) for r in result):raise RuntimeError('Automation mirrors disagree')
    text=TOML.read_text();t=tomllib.loads(text)
    if any(t[k]!=result[0][k] for k in ['status','prompt','updated_at','target_thread_id']):raise RuntimeError('Automation TOML/DB disagree')
    return result[0],text

def idle(thread):
    db=Path.home()/'.codex/thread_history_1.sqlite'
    with sqlite3.connect(f'file:{db}?mode=ro',uri=True) as c:
        turn=c.execute('select status,completed_at from thread_turns where thread_id=? order by rollout_ordinal desc limit 1',(thread,)).fetchone()
    if not turn or turn[0] not in ('completed','interrupted','failed') or not turn[1]:raise RuntimeError('Automation idle is not established')
    for db in DBS:
        with sqlite3.connect(f'file:{db}?mode=ro',uri=True) as c:
            active=c.execute("select count(*) from automation_runs where automation_id=? and status in ('running','in_progress','queued','pending')",(ID,)).fetchone()[0]
        if active:raise RuntimeError('Automation has active/queued runs')

def cas(old,text,status):
    # Same prompt-change CAS: exact prompt, status, updated_at and target thread;
    # both SQLite mirrors locked together, plus exact TOML bytes before replace.
    if TOML.read_text()!=text:raise RuntimeError('TOML changed before CAS')
    updated=max(int(time.time()*1000),old['updated_at']+1)
    c=sqlite3.connect(DBS[0]);c.execute('attach database ? as mirror',(str(DBS[1]),));c.execute('begin immediate')
    try:
        idle(old['target_thread_id'])
        for schema in ['main','mirror']:
            count=c.execute(f'update {schema}.automations set status=?,updated_at=? where id=? and status=? and updated_at=? and prompt=? and target_thread_id=?',
                (status,updated,ID,old['status'],old['updated_at'],old['prompt'],old['target_thread_id'])).rowcount
            if count!=1:raise RuntimeError('Automation CAS failed')
        if TOML.read_text()!=text:raise RuntimeError('TOML changed during CAS')
        import re
        replacement=re.sub(r'^status = "[^"]+"$',f'status = "{status}"',text,flags=re.M)
        replacement=re.sub(r'^updated_at = \d+$',f'updated_at = {updated}',replacement,flags=re.M)
        assert tomllib.loads(replacement)['status']==status and tomllib.loads(replacement)['updated_at']==updated
        temporary=TOML.with_name('automation.toml.jobpulse-cas');temporary.write_text(replacement);os.replace(temporary,TOML);c.commit()
    except: c.rollback();raise
    finally:c.close()

def copy_verified(source,target,secret=False):
    from importlib.machinery import SourceFileLoader
    stable=SourceFileLoader('snapshot_runtime',str(REPO/'review-runtime/snapshot-runtime.py')).load_module().stable_read
    data=stable(source);target.parent.mkdir(parents=True,exist_ok=True)
    temporary=target.with_name(target.name+'.transition-'+str(time.time_ns()))
    temporary.write_bytes(data);temporary.chmod(0o600)
    if digest(temporary.read_bytes())!=digest(data):raise RuntimeError('Copy hash mismatch')
    if digest(stable(source))!=digest(data):raise RuntimeError('Source changed before copy commit')
    os.replace(temporary,target)
    return None if secret else digest(data)

def service_plist():
    template=plistlib.loads((Path.home()/'Library/LaunchAgents/com.jobpulse.review-shadow.plist').read_bytes())
    template['Label']=LABEL;template['ProgramArguments'][-1]='live';template.pop('StartCalendarInterval',None);template['StartInterval']=10800;template['RunAtLoad']=False;template['KeepAlive']=False
    template['StandardOutPath']=str(RUNTIME/'live-launchd.stdout.log');template['StandardErrorPath']=str(RUNTIME/'live-launchd.stderr.log')
    return plistlib.dumps(template)

def watchdog_plist():
    return plistlib.dumps({'Label':'com.jobpulse.live-watchdog','ProgramArguments':[shutil.which('node') or 'node',str(REPO/'review-runtime/watchdog.mjs')],'StartInterval':1800,'RunAtLoad':True,'KeepAlive':False,'StandardOutPath':str(RUNTIME/'watchdog.stdout.log'),'StandardErrorPath':str(RUNTIME/'watchdog.stderr.log')})

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['cutover','rollback','assert-paused']);p.add_argument('--dry-run',action='store_true');p.add_argument('--execute',action='store_true');p.add_argument('--go',action='store_true');a=p.parse_args()
    row,text=rows()
    if a.action=='assert-paused':
        if row['status']!='PAUSED':raise RuntimeError('Legacy automation is not PAUSED')
        idle(row['target_thread_id']);print(json.dumps({'status':'paused-idle'}));return
    idle(row['target_thread_id'])
    launchd=json.loads(subprocess.check_output([shutil.which('node') or 'node',str(REPO/'review-runtime/launchd-audit.mjs'),*(['--legacy'] if row['status']=='ACTIVE' else [])],text=True))
    canonical=Path(json.loads((RUNTIME/'config.local.json').read_text())['canonicalProject'])
    if a.action=='cutover':
        if row['status']!='ACTIVE':raise RuntimeError('Cutover requires ACTIVE legacy owner')
        preflight=json.loads((RUNTIME/'round2-launchd-preflight.json').read_text());preflight_blockers=[] if preflight['status']=='passed' else ['launchd preflight: '+preflight['status']]
        latest=json.loads((RUNTIME/'shadow-launchd.stdout.log').read_text().splitlines()[-1]);
        if latest['status']!='completed-shadow' or latest['posts']!=0 or latest['llmTokens']!=0:preflight_blockers.append('scheduled shadow not completed with POST0/LLM0')
        ready=json.loads(subprocess.check_output([shutil.which('node') or 'node',str(REPO/'review-runtime/coverage-check.mjs')],text=True))
        blockers=preflight_blockers+ready['blockers']+[x['label']+': '+x['reason'] for x in launchd['blockers']]
        steps=['verify idle metadata and exact automation CAS','acquire shared review-owner lock; disable/unload idle shadow lane','CAS ACTIVE -> PAUSED in both DB mirrors and TOML','foreground hash-verified final snapshot and final-copy manifest files','copy token in-process with mode 0600, never output value/hash','enable live launchd lane every 10800 seconds and 9-hour completion watchdog (KeepAlive false)','one admitted crawl dispatch, deterministic review, final gates, persist, at most one mail; uncertain POST -> durable hold']
    else:
        blockers=[x['label']+': '+x['reason'] for x in launchd['blockers']];steps=['disable and unload live lane; require no live process remains','hash-check runtime canonical state and all durable receipts/checkpoints back to original manifest paths','CAS PAUSED -> ACTIVE in both DB mirrors and TOML; preserve originals and all evidence']
    plan={'action':a.action,'dryRun':not a.execute,'automationStatus':row['status'],'launchdAudit':launchd,'idleObserved':True,'steps':steps,'blockers':blockers,'changesMade':False,'livePostAuth':'runtime-root token, mode 0600 -> server CODEX_REVIEW_TOKEN','dispatchAuth':'gh macOS Keychain credential; launchd read-only authentication observed'}
    if not a.execute:print(json.dumps(plan,indent=2));sys.exit(1 if launchd['blockers'] else 0)
    if not a.go:raise RuntimeError('Separate supervisor go required; use --dry-run until then')
    if blockers:raise RuntimeError('Cutover readiness held: '+', '.join(blockers))
    owner_lock=(RUNTIME/'review-owner.lock').open('a+')
    try:fcntl.flock(owner_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:raise RuntimeError('Review owner active; shadow/live cannot overlap transition')
    shadow_label='com.jobpulse.review-shadow';shadow_service='gui/'+UID+'/'+shadow_label
    journal=ROOT/'cutover-journal.json'
    if a.action=='cutover':
        if journal.exists():raise RuntimeError('Prior cutover journal exists; reconcile read-only')
        journal.write_text(json.dumps({'phase':'before-pause','row':row,'toml':text}));journal.chmod(0o600)
        shadow=subprocess.run(['launchctl','print',shadow_service],capture_output=True,text=True)
        if 'state = running' in shadow.stdout:raise RuntimeError('Shadow scheduler active; retry only when idle')
        subprocess.run(['launchctl','disable',shadow_service],check=True)
        if shadow.returncode==0:subprocess.run(['launchctl','bootout',shadow_service],check=True)
        cas(row,text,'PAUSED')
        subprocess.run([sys.executable,str(REPO/'review-runtime/snapshot-runtime.py')],check=True,timeout=60)
        snapshot=(ROOT/'current-snapshot').resolve();meta=json.loads((snapshot/'snapshot-manifest.json').read_text())
        copied=[]
        for entry in meta['files']:
            if entry['relative'].startswith('legacy/'):continue
            source=snapshot/entry['relative'];dest=ROOT/entry['relative']
            dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,dest)
            if digest(dest.read_bytes())!=entry['sha256']:raise RuntimeError('Final manifest hash mismatch')
            if dest.name=='codex-direct-db-gmail-state.json':dest.chmod(0o600)
            copied.append(entry)
        token=Path('.codex_tmp/review-inbox/.codex-review-token');copy_verified(canonical/token,ROOT/token,secret=True)
        (ROOT/'live-authorization.json').write_text(json.dumps({'at':time.time(),'files':copied,'legacyStateSha256':next(e['sha256'] for e in copied if e['relative'].endswith('codex-direct-db-gmail-state.json'))}));(ROOT/'live-authorization.json').chmod(0o600)
        PLIST.write_bytes(service_plist());subprocess.run(['plutil','-lint',str(PLIST)],check=True)
        subprocess.run(['launchctl','enable','gui/'+UID+'/'+LABEL],check=True);subprocess.run(['launchctl','bootstrap','gui/'+UID,str(PLIST)],check=True)
        watchdog=Path.home()/'Library/LaunchAgents/com.jobpulse.live-watchdog.plist';watchdog.write_bytes(watchdog_plist())
        subprocess.run(['launchctl','bootstrap','gui/'+UID,str(watchdog)],check=True)
        print(json.dumps({'status':'cutover-enabled','legacy':'PAUSED','intervalSeconds':10800,'tokenPrinted':False}))
    else:
        subprocess.run(['launchctl','disable','gui/'+UID+'/'+LABEL],check=True)
        service=subprocess.run(['launchctl','print','gui/'+UID+'/'+LABEL],capture_output=True,text=True)
        if 'state = running' in service.stdout:raise RuntimeError('Live run active; hold rollback until idle, never interrupt an uncertain POST')
        if service.returncode==0:subprocess.run(['launchctl','bootout','gui/'+UID+'/'+LABEL],check=True)
        subprocess.run(['launchctl','bootout','gui/'+UID+'/com.jobpulse.live-watchdog'],capture_output=True)
        auth=json.loads((ROOT/'live-authorization.json').read_text())
        if row['status']!='PAUSED':raise RuntimeError('Rollback requires legacy PAUSED')
        for entry in auth['files']:
            if (entry['relative'].startswith('.codex_tmp/') and not entry['relative'].endswith(('.mjs','.ts'))) or entry['relative'] in ['review-runtime/undated-source-observations.json','review-runtime/community-lookup-checkpoints.json']:
                source=ROOT/entry['relative'];original=Path(entry['source'])
                if str(original).startswith(str(canonical)) or original in [RUNTIME/'undated-source-observations.json',RUNTIME/'community-lookup-checkpoints.json']:copy_verified(source,original)
        # Preserve attempt receipts for quarantine before restoring legacy.
        # Legacy does not understand the new attempt ledger: unresolved attempts
        # must be reconciled read-only before re-enabling its writer.
        if (ROOT/'live-hold.json').exists():raise RuntimeError('Uncertain live attempt: reconciliation required before legacy ACTIVE')
        cas(row,text,'ACTIVE')
        subprocess.run([sys.executable,str(REPO/'review-runtime/snapshot-runtime.py')],check=True,timeout=60)
        # Authorization remains as a retained record; shadow resumes only after explicit rollback marker.
        (ROOT/'rollback-completed.json').write_text(json.dumps({'at':time.time()}))
        subprocess.run(['launchctl','enable',shadow_service],check=True)
        subprocess.run(['launchctl','bootstrap','gui/'+UID,str(Path.home()/'Library/LaunchAgents/com.jobpulse.review-shadow.plist')],check=True)
        print(json.dumps({'status':'rollback-restored','legacy':'ACTIVE','tokenPrinted':False}))
if __name__=='__main__':
    try:main()
    except Exception as e:print(json.dumps({'status':'hold-transition','reason':str(e),'changesMade':'see phase journal if --execute was used'}));sys.exit(1)
