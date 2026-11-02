import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {boundedCrawlCheck} from '../scripts/check-production-crawl.mjs';import {recordRun,checkWatchdog} from './run-status.mjs';import {auditLaunchdJobs} from './launchd-audit.mjs';
test('latest heartbeat includes completed integrity holds but excludes unfinished runs',async()=>{
 const {spawnSync}=await import('node:child_process');
 const script=`
import importlib.util,tempfile,pathlib,json
spec=importlib.util.spec_from_file_location('snapshot','review-runtime/snapshot-runtime.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(prefix='job-pulse-snapshot-selection-') as root:
 runs=pathlib.Path(root)
 for stamp,status,completed in [('20261102T145302','complete',True),('20261102T175217','complete_with_integrity_holds',True),('20261102T185217','complete_with_integrity_holds',False),('20261102T195217','running',True)]:
  p=runs/('heartbeat-'+stamp);p.mkdir();(p/'summary.json').write_text(json.dumps({'status':status,'reviewCompletionEstablished':completed}))
 assert m.latest_completed_heartbeat(runs)=='heartbeat-20261102T175217'
`;
 const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('403 skips this crawl only and keeps existing-data review eligible',async()=>{let dispatches=0;const r=await boundedCrawlCheck({request:async()=>{throw Error('HTTP 403 API rate limit exceeded');},dispatch:async()=>dispatches++,repair:true});assert.equal(r.reviewExistingData,true);assert.equal(r.githubCalls,1);assert.equal(dispatches,0);});
test('GitHub cap bounds every request',async()=>{let calls=0;await assert.rejects(boundedCrawlCheck({request:async()=>{calls++;return {workflow_runs:[{id:1,created_at:new Date().toISOString(),status:'completed'}],jobs:[],total_count:0};},dispatch:async()=>{},cap:2}),/call cap/);assert.equal(calls,2);});
test('launchd unexpected and KeepAlive jobs fail; normal expected jobs pass',()=>{assert.equal(auditLaunchdJobs([{label:'com.jobpulse.review-shadow',keepAlive:false}]).length,0);assert.equal(auditLaunchdJobs([{label:'com.jobpulse.runtime-preflight',keepAlive:false},{label:'com.jobpulse.review-shadow',keepAlive:true}]).length,2);});
test('hold status and nine-hour watchdog notify locally through an injected sink only',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'job-pulse-status-')),file=path.join(dir,'status.jsonl'),notices=[],notify=async kind=>notices.push(kind);await recordRun({status:'complete',at:'2026-11-01T00:00:00Z'},{file,notify});await recordRun({status:'hold',at:'2026-11-01T01:00:00Z'},{file,notify});assert.equal((await checkWatchdog({file,asOf:'2026-11-01T08:59:59Z',notify})).due,false);assert.equal((await checkWatchdog({file,asOf:'2026-11-01T09:00:00Z',notify})).notified,true);assert.equal((await checkWatchdog({file,asOf:'2026-11-01T09:30:00Z',notify})).notified,false);assert.deepEqual(notices,['hold','watchdog']);assert.equal((await fs.readFile(file,'utf8')).trim().split('\n').length,3);});

test('scheduler waits through live deadline without signalling transport; interrupted automation CAS recovers from journal',async()=>{
 const {spawnSync}=await import('node:child_process');
 const script=`
import importlib.util,tempfile,pathlib,sqlite3,json,subprocess,types,os
source=pathlib.Path('review-runtime/scheduled-run.py').read_text().split('runtime=Path.home()')[0]
ns={};exec(source,ns)
class Process:
 pid=123
 def __init__(self):self.calls=0
 def wait(self,timeout=None):
  self.calls+=1
  if self.calls==1:raise subprocess.TimeoutExpired('fixture',1200)
  return 0
p=Process();ns['subprocess'].Popen=lambda *a,**kw:p
ns['os'].killpg=lambda *a:(_ for _ in ()).throw(Exception('must not signal live'))
assert ns['bounded_run'](['fixture'],env={'JOB_PULSE_LANE':'live'}).returncode==0
spec=importlib.util.spec_from_file_location('transition','review-runtime/transition.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
base=pathlib.Path(tempfile.mkdtemp(prefix='job-pulse-cas-'));m.ROOT=base;m.DBS=[base/'one.db',base/'two.db'];m.TOML=base/'automation.toml';m.idle=lambda _:None
old={'id':m.ID,'status':'ACTIVE','updated_at':1,'prompt':'same','target_thread_id':'fixture'}
text='id = "'+m.ID+'"\\nstatus = "ACTIVE"\\nupdated_at = 1\\nprompt = "same"\\ntarget_thread_id = "fixture"\\n';m.TOML.write_text(text)
for db in m.DBS:
 with sqlite3.connect(db) as c:
  c.execute('create table automations(id text,status text,updated_at integer,prompt text,target_thread_id text)');c.execute('insert into automations values(?,?,?,?,?)',tuple(old.values()))
try:m.cas(old,text,'PAUSED',_test_after_toml=True)
except RuntimeError:pass
else:raise Exception('injection missing')
m.recover_cas();row,_=m.rows();assert row['status']=='PAUSED';m.recover_cas()
print('safe deadline and CAS recovery observed')
`;
 const r=spawnSync('/usr/local/bin/python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);
});
