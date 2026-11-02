"""Persistent lock files are retained; launchd never starts a second same lane."""
import fcntl,subprocess,sys,json,os,datetime
from pathlib import Path
runtime=Path.home()/'Library/Application Support/Job Pulse/review-runtime'
repo=runtime.parent/'repo';lane=sys.argv[1]
assert lane in ('shadow','platform')
with (runtime/(lane+'.lock')).open('a+') as lock:
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:print(json.dumps({'status':'skipped-active-lane','lane':lane}));sys.exit(0)
 if lane=='platform':
  day=datetime.datetime.now(datetime.timezone.utc).date().isoformat();usage=runtime/'platform-runs'/day/'usage.json'
  if usage.exists() and any(x.get('inputTokens',0)>0 for x in json.loads(usage.read_text())):
   print(json.dumps({'status':'already-completed-today','lane':lane}));sys.exit(0)
 env={**os.environ,'JOB_PULSE_RUNTIME':str(runtime)}
 node=env.get('JOB_PULSE_NODE','/opt/homebrew/bin/node')
 if not Path(node).exists():node=subprocess.check_output(['/usr/bin/which','node'],text=True).strip()
 script=repo/'review-runtime'/('review-run.mjs' if lane=='shadow' else 'platform-run.mjs')
 result=subprocess.run([node,str(script)],cwd=repo,env=env)
 if lane=='platform' and result.returncode==0:
  day=subprocess.check_output(['/bin/date','-u','+%Y-%m-%d'],text=True).strip()
  result=subprocess.run([node,str(repo/'review-runtime/community-resolve.mjs'),str(runtime/'platform-runs'/day/'candidates.json')],cwd=repo,env=env)
  if result.returncode==0:result=subprocess.run([node,str(repo/'review-runtime/platform-reconcile.mjs'),str(runtime/'platform-runs'/day/'resolved-candidates.json'),'--publish-queue'],cwd=repo,env=env)
 sys.exit(result.returncode)
