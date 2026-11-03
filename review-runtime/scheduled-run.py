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

runtime=Path.home()/'Library/Application Support/Job Pulse/review-runtime'
repo=runtime.parent/'repo';lane=sys.argv[1]
assert lane in ('shadow','platform','live')
with (runtime/(lane+'.lock')).open('a+') as lock:
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:print(json.dumps({'status':'skipped-active-lane','lane':lane}));sys.exit(0)
 if lane=='platform':
  day=datetime.datetime.now(datetime.timezone.utc).date().isoformat();usage=runtime/'platform-runs'/day/'usage.json'
  if usage.exists() and any(x.get('inputTokens',0)>0 for x in json.loads(usage.read_text())):
   print(json.dumps({'status':'already-completed-today','lane':lane}));sys.exit(0)
 env={**os.environ,'JOB_PULSE_LANE':lane,'JOB_PULSE_RUNTIME':str(runtime),'JOB_PULSE_STATUS_RUN_ID':datetime.datetime.now(datetime.timezone.utc).isoformat()+'-'+str(os.getpid())}
 node=env.get('JOB_PULSE_NODE','/opt/homebrew/bin/node')
 if not Path(node).exists():node=subprocess.check_output(['/usr/bin/which','node'],text=True).strip()
 if lane=='platform':
  # The Handshake read never blocks the rest of the daily lane.
  try:env['JOB_PULSE_NODE_REPL']=json.dumps(tomllib.loads((Path.home()/'.codex/config.toml').read_text())['mcp_servers']['node_repl'])
  except (OSError,KeyError,ValueError) as error:print(json.dumps({'status':'handshake-config-unavailable','error':type(error).__name__}),flush=True)
  bounded_run([node,str(repo/'review-runtime/handshake-run.mjs')],cwd=repo,env=env)
 script=repo/'review-runtime'/('review-run.mjs' if lane=='shadow' else 'live-run.mjs' if lane=='live' else 'platform-run.mjs')
 result=bounded_run([node,str(script)],cwd=repo,env=env)
 if lane=='platform' and result.returncode==0:
  day=subprocess.check_output(['/bin/date','-u','+%Y-%m-%d'],text=True).strip()
  bounded_run([node,str(repo/'review-runtime/handshake-run.mjs'),'--merge',str(runtime/'platform-runs'/day/'candidates.json')],cwd=repo,env=env)
  result=bounded_run([node,str(repo/'review-runtime/community-resolve.mjs'),str(runtime/'platform-runs'/day/'candidates.json')],cwd=repo,env=env)
  if result.returncode==0:result=bounded_run([node,str(repo/'review-runtime/platform-reconcile.mjs'),str(runtime/'platform-runs'/day/'resolved-candidates.json'),'--publish-queue'],cwd=repo,env=env)
 if lane=='live' and result.returncode!=0:
  subprocess.run([node,str(repo/'review-runtime/run-status.mjs'),'--scheduler-failure'],cwd=repo,env=env,timeout=15)
 sys.exit(result.returncode)
