"""Cutover/rollback preparation. Only --dry-run is exercised in maintenance.
Execution requires separate supervisor go and verified secondary coverage.
"""
import tempfile, uuid, gzip
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

def cas(old,text,status,_test_after_toml=False):
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
        desired={**old,'status':status,'updated_at':updated}
        durable_json(ROOT/'automation-cas.json',{'status':'intent','old':old,'text':text,'desired':desired,'replacement':replacement})
        temporary=TOML.with_name('automation.toml.jobpulse-cas')
        with temporary.open('w') as f:f.write(replacement);f.flush();os.fsync(f.fileno())
        os.replace(temporary,TOML)
        if _test_after_toml:raise RuntimeError('Injected CAS crash after TOML replace')
        c.commit();durable_json(ROOT/'automation-cas.json',{'status':'completed'})
    except: c.rollback();raise
    finally:c.close()

def recover_cas():
    file=ROOT/'automation-cas.json'
    if not file.exists():return
    j=json.loads(file.read_text())
    if j['status']=='completed':return
    old,new=j['old'],j['desired'];keys=['status','updated_at','prompt','target_thread_id']
    if TOML.read_text() not in [j['text'],j['replacement']]:raise RuntimeError('CAS recovery TOML conflict')
    c=sqlite3.connect(DBS[0]);c.row_factory=sqlite3.Row;c.execute('attach database ? as mirror',(str(DBS[1]),));c.execute('begin immediate')
    try:
        idle(new['target_thread_id'])
        for schema in ['main','mirror']:
            row=dict(c.execute(f'select * from {schema}.automations where id=?',(ID,)).fetchone())
            if not any(all(row[k]==v[k] for k in keys) for v in [old,new]):raise RuntimeError('CAS recovery DB conflict')
            c.execute(f'update {schema}.automations set status=?,updated_at=? where id=?',(new['status'],new['updated_at'],ID))
        temporary=TOML.with_name('automation.toml.jobpulse-recover')
        with temporary.open('w') as f:f.write(j['replacement']);f.flush();os.fsync(f.fileno())
        os.replace(temporary,TOML);c.commit();durable_json(file,{'status':'completed'})
    except:c.rollback();raise
    finally:c.close()

def copy_verified(source,target,secret=False):
    from importlib.machinery import SourceFileLoader
    stable=SourceFileLoader('snapshot_runtime',str(REPO/'review-runtime/snapshot-runtime.py')).load_module().stable_read
    data=stable(source)
    if not data:raise RuntimeError('Empty copy input')
    if source.name=='codex-direct-db-gmail-state.json':
        new=json.loads(data)
        if target.exists():record_superset(state_bytes(target)[1],new)
    target.parent.mkdir(parents=True,exist_ok=True)
    temporary=target.with_name(target.name+'.transition-'+str(time.time_ns()))
    with temporary.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
    temporary.chmod(0o600)
    if digest(temporary.read_bytes())!=digest(data):raise RuntimeError('Copy hash mismatch')
    if digest(stable(source))!=digest(data):raise RuntimeError('Source changed before copy commit')
    os.replace(temporary,target)
    fd=os.open(target.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
    return None if secret else digest(data)

def service_plist():
    template=plistlib.loads((Path.home()/'Library/LaunchAgents/com.jobpulse.review-shadow.plist').read_bytes())
    template['Label']=LABEL;template['ProgramArguments'][-1]='live';template.pop('StartCalendarInterval',None);template['StartInterval']=10800;template['RunAtLoad']=False;template['KeepAlive']=False
    template['StandardOutPath']=str(RUNTIME/'live-launchd.stdout.log');template['StandardErrorPath']=str(RUNTIME/'live-launchd.stderr.log')
    return plistlib.dumps(template)

def watchdog_plist():
    return plistlib.dumps({'Label':'com.jobpulse.live-watchdog','ProgramArguments':[shutil.which('node') or 'node',str(REPO/'review-runtime/watchdog.mjs')],'StartInterval':1800,'RunAtLoad':True,'KeepAlive':False,'StandardOutPath':str(RUNTIME/'watchdog.stdout.log'),'StandardErrorPath':str(RUNTIME/'watchdog.stderr.log')})

def durable_json(file,value):
    file.parent.mkdir(parents=True,exist_ok=True)
    temp=file.with_name(file.name+'.atomic-'+uuid.uuid4().hex)
    with temp.open('x') as f:
        os.chmod(temp,0o600);json.dump(value,f);f.flush();os.fsync(f.fileno())
    json.loads(temp.read_text());os.replace(temp,file)
    fd=os.open(file.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)

def state_bytes(file):
    data=file.read_bytes()
    if not data:raise RuntimeError('Empty state input')
    value=json.loads(data)
    if not isinstance(value.get('records'),dict):raise RuntimeError('Invalid state records')
    return data,value

def record_superset(old,new):
    for key,r in old['records'].items():
        n=new['records'].get(key)
        if not n or any(n.get(k)!=v for k,v in r.items() if k not in ['sentAt','identityAlreadyNotified']) or (r.get('sentAt') and not n.get('sentAt')) or (r.get('identityAlreadyNotified') and not n.get('identityAlreadyNotified')):
            raise RuntimeError('State record lost/regressed: '+key)

def refuse_attempts(root,runtime):
    hold=root/'live-hold.json';inflight=root/'live-inflight.json'
    if hold.exists() and not json.loads(hold.read_text()).get('resolved'):raise RuntimeError('Uncertain live hold: reconcile first')
    if inflight.exists() and json.loads(inflight.read_text()).get('status')!='completed':raise RuntimeError('Unresolved inflight attempt: reconcile first')
    for file in (runtime/'live-runs').glob('*/post-attempt-*.json'):
        if json.loads(gzip.decompress(file.read_bytes()) if file.read_bytes()[:2]==b'\x1f\x8b' else file.read_bytes()).get('status')!='completed':raise RuntimeError('Unresolved POST attempt: reconcile first')

def execute_transition(action,canonical,*,rehearsal=False,fail_after=None):
    journal=ROOT/'cutover-journal.json';ROOT.mkdir(parents=True,exist_ok=True)
    j=json.loads(journal.read_text()) if journal.exists() else {'done':[]}
    if j.get('rolledBack') and action=='cutover':raise RuntimeError('Prior rollback retained; new transfer requires a new journal')
    def phase(name,fn):
        key=action+':'+name
        if key in j['done']:return
        j['phase']=key;j['intent']=True;durable_json(journal,j)
        fn();durable_json(journal,j)
        if fail_after==name:raise RuntimeError('Injected failure after side effect, before phase commit: '+name)
        j['done'].append(key);j['intent']=False;durable_json(journal,j)
    state_rel=Path('.codex_tmp/codex-direct-db-gmail-state.json')
    def owner():return json.loads((BASE/'automation.json').read_text()) if rehearsal else rows()[0]
    def set_owner(status):
        row=owner()
        if row['status']==status:return
        if rehearsal:durable_json(BASE/'automation.json',{'status':status})
        else:cas(*rows(),status)
    def service(label,enabled):
        if rehearsal:
            f=BASE/'services.json';v=json.loads(f.read_text()) if f.exists() else {};v[label]=enabled;durable_json(f,v);return
        target='gui/'+UID+'/'+label
        result=subprocess.run(['launchctl','print',target],capture_output=True,text=True)
        if 'state = running' in result.stdout:raise RuntimeError('Lane running; never interrupt transport')
        subprocess.run(['launchctl','enable' if enabled else 'disable',target],check=True)
        if enabled and result.returncode!=0:
            subprocess.run(['launchctl','bootstrap','gui/'+UID,str(Path.home()/'Library/LaunchAgents'/(label+'.plist'))],check=True)
        elif not enabled and result.returncode==0:subprocess.run(['launchctl','bootout',target],check=True)
    if action=='cutover':
        if owner()['status'] not in ('ACTIVE','PAUSED'):raise RuntimeError('Invalid legacy owner')
        if owner()['status']=='PAUSED' and not journal.exists():raise RuntimeError('PAUSED without transfer journal')
        def capture():
            j['canonical']=str(canonical)
            if not rehearsal:j['legacyRow'],j['legacyToml']=rows()
        phase('captured',capture)
        phase('shadow-disabled',lambda:service('com.jobpulse.review-shadow',False))
        def pause():
            set_owner('PAUSED')
            if owner()['status']!='PAUSED':raise RuntimeError('Legacy pause not confirmed')
            if not rehearsal:idle(owner()['target_thread_id'])
            data,_=state_bytes(canonical/state_rel);j['legacyStateSha256']=digest(data)
        phase('paused',pause)
        def snapshot():
            if not rehearsal:subprocess.run([sys.executable,str(REPO/'review-runtime/snapshot-runtime.py')],check=True,timeout=60)
            j['snapshot']=str((ROOT/'current-snapshot').resolve())
        phase('snapshot',snapshot)
        def transfer():
            snap=Path(j['snapshot']);meta=json.loads((snap/'snapshot-manifest.json').read_text());copied=[]
            for entry in meta['files']:
                if entry['relative'].startswith('legacy/'):continue
                src=snap/entry['relative'];dest=ROOT/entry['relative'];dest.parent.mkdir(parents=True,exist_ok=True)
                data=src.read_bytes()
                if digest(data)!=entry['sha256']:raise RuntimeError('Final manifest hash mismatch')
                if dest==ROOT/state_rel:
                    _,old=state_bytes(canonical/state_rel);_,new=state_bytes(src);record_superset(old,new)
                temp=dest.with_name(dest.name+'.transfer-'+uuid.uuid4().hex)
                with temp.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
                temp.chmod(0o600);observed=src.stat();os.utime(temp,ns=(observed.st_atime_ns,observed.st_mtime_ns));os.replace(temp,dest);copied.append(entry)
            if digest((canonical/state_rel).read_bytes())!=j['legacyStateSha256']:raise RuntimeError('Original state changed during transfer')
            j['files']=copied
        phase('transferred',transfer)
        def authorize():
            if not rehearsal:
                token=Path('.codex_tmp/review-inbox/.codex-review-token');copy_verified(canonical/token,ROOT/token,secret=True)
            durable_json(ROOT/'live-authorization.json',{'at':time.time(),'files':j['files'],'legacyStateSha256':j['legacyStateSha256']})
        phase('authorized',authorize)
        def install():
            if not rehearsal:
                PLIST.write_bytes(service_plist());subprocess.run(['plutil','-lint',str(PLIST)],check=True)
                (Path.home()/'Library/LaunchAgents/com.jobpulse.live-watchdog.plist').write_bytes(watchdog_plist())
            service(LABEL,True);service('com.jobpulse.live-watchdog',True)
        phase('installed',install)
        return {'status':'cutover-enabled','legacy':owner()['status']}
    # Every refusal precedes service changes, backup, or any write to the original.
    refuse_attempts(ROOT,RUNTIME)
    if not journal.exists():raise RuntimeError('Rollback requires transfer journal')
    if owner()['status']!='PAUSED' and 'rollback:active' not in j['done'] and 'cutover:paused' in j['done'] and not (j.get('phase')=='rollback:active' and j.get('intent')):raise RuntimeError('Rollback requires legacy PAUSED')
    auth=ROOT/'live-authorization.json'
    expected=json.loads(auth.read_text())['legacyStateSha256'] if auth.exists() else j.get('legacyStateSha256')
    backup=ROOT/'rollback-original-state.backup.json'
    if 'rollback:copied' not in j['done']:
        original,old=state_bytes(canonical/state_rel)
        # A crash after rename but before journaling is recognised only by the
        # durable intended copy hash and the retained original backup.
        already_copied=backup.exists() and j.get('rollbackStateSha256')==digest(original)
        if expected is not None and digest(original)!=expected and not already_copied:raise RuntimeError('Legacy original changed since cutover')
        if auth.exists():
            data,new=state_bytes(ROOT/state_rel)
            record_superset(json.loads(backup.read_text()) if already_copied else old,new)
    phase('live-disabled',lambda:(service(LABEL,False),service('com.jobpulse.live-watchdog',False)))
    def restore():
        if not auth.exists():return
        original,old=state_bytes(canonical/state_rel);data,new=state_bytes(ROOT/state_rel)
        record_superset(json.loads(backup.read_text()) if backup.exists() else old,new)
        if not backup.exists():copy_verified(canonical/state_rel,backup)
        if digest(backup.read_bytes())!=expected:raise RuntimeError('Original backup hash mismatch')
        j['rollbackStateSha256']=digest(data);durable_json(journal,j)
        # copy_verified checks source stability; state parse/superset already checked.
        copy_verified(ROOT/state_rel,canonical/state_rel)
        for entry in json.loads(auth.read_text())['files']:
            rel=entry['relative']
            if rel in ['review-runtime/undated-source-observations.json','review-runtime/community-lookup-checkpoints.json']:
                source=ROOT/rel
                if source.exists():copy_verified(source,RUNTIME/Path(rel).name)
    phase('copied',restore)
    phase('marked',lambda:durable_json(ROOT/'rollback-completed.json',{'at':time.time()}))
    phase('active',lambda:set_owner('ACTIVE'))
    phase('shadow-enabled',lambda:service('com.jobpulse.review-shadow',True))
    j['rolledBack']=True;durable_json(journal,j)
    return {'status':'rollback-restored','legacy':owner()['status']}

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['cutover','rollback','assert-paused']);p.add_argument('--dry-run',action='store_true');p.add_argument('--execute',action='store_true');p.add_argument('--go',action='store_true');p.add_argument('--rehearsal-root');p.add_argument('--fail-after');a=p.parse_args()
    global BASE,RUNTIME,ROOT,REPO
    if a.rehearsal_root:
        base=Path(a.rehearsal_root).resolve()
        if not base.is_relative_to(Path(tempfile.gettempdir()).resolve()):raise RuntimeError('Temporary rehearsal root required')
        BASE=base;RUNTIME=base/'review-runtime';ROOT=base/'runtime-root';REPO=Path(__file__).resolve().parent.parent
        if a.action=='assert-paused':raise RuntimeError('Use real assertion entry in rehearsal')
        print(json.dumps(execute_transition(a.action,base/'original',rehearsal=True,fail_after=a.fail_after)));return
    if a.execute and a.go:recover_cas()
    row,text=rows()
    if a.action=='assert-paused':
        if row['status']!='PAUSED':raise RuntimeError('Legacy automation is not PAUSED')
        idle(row['target_thread_id']);print(json.dumps({'status':'paused-idle'}));return
    idle(row['target_thread_id'])
    launchd=json.loads(subprocess.check_output([shutil.which('node') or 'node',str(REPO/'review-runtime/launchd-audit.mjs'),*(['--legacy'] if row['status']=='ACTIVE' else [])],text=True))
    canonical=Path(json.loads((RUNTIME/'config.local.json').read_text())['canonicalProject'])
    if a.action=='cutover':
        if row['status']!='ACTIVE' and not (ROOT/'cutover-journal.json').exists():raise RuntimeError('Cutover requires ACTIVE or resumable journal')
        preflight=json.loads((RUNTIME/'round2-launchd-preflight.json').read_text());preflight_blockers=[] if preflight['status']=='passed' else ['launchd preflight: '+preflight['status']]
        latest=json.loads((RUNTIME/'shadow-launchd.stdout.log').read_text().splitlines()[-1]);
        if latest['status']!='completed-shadow' or latest['posts']!=0 or latest['llmTokens']!=0:preflight_blockers.append('scheduled shadow not completed with POST0/LLM0')
        ready=json.loads(subprocess.check_output([shutil.which('node') or 'node',str(REPO/'review-runtime/coverage-check.mjs')],text=True))
        blockers=preflight_blockers+ready['blockers']+[x['label']+': '+x['reason'] for x in launchd['blockers']]
        steps=['verify idle metadata and exact automation CAS','acquire shared review-owner lock; disable/unload idle shadow lane','CAS ACTIVE -> PAUSED in both DB mirrors and TOML','foreground hash-verified final snapshot and final-copy manifest files','copy token in-process with mode 0600, never output value/hash','enable live launchd lane every 10800 seconds and 9-hour completion watchdog (KeepAlive false)','one admitted crawl dispatch, deterministic review, final gates, persist, at most one mail; uncertain POST -> durable hold']
    else:
        blockers=[x['label']+': '+x['reason'] for x in launchd['blockers']];steps=['disable and unload live lane; require no live process remains','hash-check runtime canonical state and all durable receipts/checkpoints back to original manifest paths','CAS PAUSED -> ACTIVE in both DB mirrors and TOML; preserve originals and all evidence']
    plan={'action':a.action,'dryRun':not a.execute,'automationStatus':row['status'],'launchdAudit':launchd,'idleObserved':True,'steps':steps,'blockers':blockers,'changesMade':False,'livePostAuth':'runtime-root token, mode 0600 -> server CODEX_REVIEW_TOKEN','dispatchAuth':'gh macOS Keychain credential; launchd read-only authentication observed'}
    if not a.execute:print(json.dumps(plan,indent=2));sys.exit(1 if blockers else 0)
    if not a.go:raise RuntimeError('Separate supervisor go required; use --dry-run until then')
    if blockers:raise RuntimeError('Cutover readiness held: '+', '.join(blockers))
    owner_lock=(RUNTIME/'review-owner.lock').open('a+')
    try:fcntl.flock(owner_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:raise RuntimeError('Review owner active; shadow/live cannot overlap transition')
    print(json.dumps(execute_transition(a.action,canonical)))
if __name__=='__main__':
    try:main()
    except Exception as e:print(json.dumps({'status':'hold-transition','reason':str(e),'changesMade':'see phase journal if --execute was used'}));sys.exit(1)
