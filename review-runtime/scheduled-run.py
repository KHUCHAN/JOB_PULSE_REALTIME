"""Persistent lock files are retained; launchd never starts a second same lane."""
import fcntl,subprocess,sys,json,os,datetime,signal,tomllib,types
from pathlib import Path
def bounded_run(args,**kwargs):
 process=subprocess.Popen(args,start_new_session=True,**kwargs)
 try:return types.SimpleNamespace(returncode=process.wait(timeout=1200))
 except subprocess.TimeoutExpired:
  if kwargs.get('env',{}).get('JOB_PULSE_LANE')=='live':
   print(json.dumps({'status':'live-deadline-exceeded-waiting-for-safe-exit'}),flush=True)
   return types.SimpleNamespace(returncode=process.wait())
  os.killpg(process.pid,signal.SIGTERM)
  try:process.wait(timeout=5)
  except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
  print(json.dumps({'status':'hold-timeout','postsByScheduler':0}));return types.SimpleNamespace(returncode=124)

def needs_reconcile(root):
 for name,settled in (('live-hold.json',lambda x:x.get('resolved')),('live-inflight.json',lambda x:x.get('status')=='completed')):
  try:
   if not settled(json.loads((root/name).read_text())):return True
  except FileNotFoundError:pass
  except ValueError:return True
 return False

runtime=Path.home()/'Library/Application Support/Job Pulse/review-runtime'
repo=runtime.parent/'repo';lane=sys.argv[1]
assert lane in ('shadow','platform','live')
with (runtime/(lane+'.lock')).open('a+') as lock:
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:print(json.dumps({'status':'skipped-active-lane','lane':lane}));sys.exit(0)
 if lane=='platform':
  day=datetime.datetime.now(datetime.timezone.utc).date().isoformat();usage=runtime/'platform-runs'/day/'usage.json'
  if usage.exists() and any(x.get('status')=='completed' for x in json.loads(usage.read_text())):
   print(json.dumps({'status':'already-completed-today','lane':lane}));sys.exit(0)
 env={**os.environ,'JOB_PULSE_LANE':lane,'JOB_PULSE_RUNTIME':str(runtime),'JOB_PULSE_STATUS_RUN_ID':datetime.datetime.now(datetime.timezone.utc).isoformat()+'-'+str(os.getpid())}
 node=env.get('JOB_PULSE_NODE','/opt/homebrew/bin/node')
 if not Path(node).exists():node=subprocess.check_output(['/usr/bin/which','node'],text=True).strip()
 if lane=='platform':
  # The Handshake read never blocks the rest of the daily lane.
  try:env['JOB_PULSE_NODE_REPL']=json.dumps(tomllib.loads((Path.home()/'.codex/config.toml').read_text())['mcp_servers']['node_repl'])
  except (OSError,KeyError,ValueError) as error:print(json.dumps({'status':'handshake-config-unavailable','error':type(error).__name__}),flush=True)
  # Script readers run first so Codex only searches for rows they could not resolve. A failed read or search never blocks the queue.
  review=repo/'review-runtime';day=datetime.datetime.now(datetime.timezone.utc).date().isoformat();base=runtime/'platform-runs'/day;candidates=base/'candidates.json';resolved=base/'resolved-candidates.json'
  bounded_run([node,str(review/'handshake-run.mjs')],cwd=repo,env=env)
  bounded_run([node,str(review/'linkedin-run.mjs')],cwd=repo,env=env)
  bounded_run([node,str(review/'platform-mail-queue.mjs')],cwd=repo,env=env)
  result=bounded_run([node,str(review/'platform-run.mjs'),'--merge',str(candidates)],cwd=repo,env=env)
  if result.returncode==0:result=bounded_run([node,str(review/'community-resolve.mjs'),str(candidates)],cwd=repo,env=env)
  if result.returncode==0:
   bounded_run([node,str(review/'platform-run.mjs'),str(resolved)],cwd=repo,env=env)
   result=bounded_run([node,str(review/'platform-reconcile.mjs'),str(resolved),'--publish-queue'],cwd=repo,env=env)
  sys.exit(result.returncode)
 if lane=='live' and needs_reconcile(runtime.parent/'runtime-root'):
  # Server reads only: it lifts the hold when every POST is proven and otherwise leaves it, so nothing is ever re-sent.
  print(json.dumps({'status':'reconciling-hold','returncode':bounded_run([node,str(repo/'review-runtime/reconcile.mjs')],cwd=repo,env=env).returncode}),flush=True)
 script=repo/'review-runtime'/('review-run.mjs' if lane=='shadow' else 'live-run.mjs')
 result=bounded_run([node,str(script)],cwd=repo,env=env)
 if lane=='live' and result.returncode!=0:
  subprocess.run([node,str(repo/'review-runtime/run-status.mjs'),'--scheduler-failure'],cwd=repo,env=env,timeout=15)
 sys.exit(result.returncode)
