"""Shared, retained fcntl lock for every direct or scheduled review invocation."""
import fcntl,json,os,subprocess,sys
from pathlib import Path
runtime=Path(os.environ.get('JOB_PULSE_RUNTIME',str(Path.home()/'Library/Application Support/Job Pulse/review-runtime')))
with (runtime/'review-owner.lock').open('a+') as lock:
    try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:
        print(json.dumps({'status':'hold-review-owner-active','posts':0,'llmTokens':0}));sys.exit(1)
    sys.exit(subprocess.run(sys.argv[1:],env={**os.environ,'JOB_PULSE_REVIEW_LOCK':'held'}).returncode)
