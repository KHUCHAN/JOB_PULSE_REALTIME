# Recovery pacing after production D1 overload

## Verified baseline

Owner workflow 34220039996, source 21787285f7e1448d171db056c50b793a6adb5de9,
ran 2026-09-08 11:18:58–11:53:40 UTC (34m42s). The native step took
27m46s; request recovery about 2m52s; browser recovery about 3m18s.
Recovery failures still made the workflow fail. Compared with the prior
43m39s run, runtime fell, but workload differs: this is not a controlled
measurement of a single optimization.

The native step logged ten request errors, including eight explicit D1
queue-overload errors in two waves at 11:38 and 11:41 UTC. Concurrency had
returned to four before both waves. In request recovery, Google took
12.845s fetching, 42.582s waiting for a writer and 24.332s ingesting;
Stripe took 0.351s fetching, 19.956s waiting and 4.062s ingesting.
Increasing upstream parallelism cannot remove this storage bottleneck.

## Fix

Previously three clean rounds could increase concurrency regardless of elapsed
time. Small sources and late successes from already-active requests could
quickly undo a backoff while the storage queue was still recovering.

The existing Node.js/TypeScript owner pool now requires both three clean rounds
and 30 seconds between increases. After an error, capacity remains reduced for
at least 60 seconds from the most recent error. Work continues at the reduced
limit after the existing bounded 5–30 second cooldown; it does not sleep for
the whole recovery window. An isolated successful response no longer resets
the exponential cooldown. A sustained clean recovery does reset it.

No sources are skipped, request limits raised, or source crawls replayed. The
existing deadline, in-flight settlement, empty-queue probe, fatal-auth handling,
identity/delivery rules and four Gmail recipients are unchanged. The injected
pool clock also drives backpressure, allowing deterministic integration tests.

## Verification boundary

Unit tests cover clean-time gates, intermittent errors, bounded cooldown and
single-lane caps. A fake-clock pool test checks continued work at one lane,
later recovery to two lanes, all 80 successful tasks accounted for, and no
remaining in-flight requests. These are correctness tests, not a production
speed forecast. End-to-end improvement must be measured on the next naturally
scheduled owner run; no duplicate crawl is started for deployment.

All 1,263 tests across 86 files and the TypeScript check pass after this change.

At 16:14 UTC the latest visible scheduled run remained 11:18 UTC despite an
active `17 */2 * * *` workflow. Missing/delayed launches are a separate upstream
scheduling problem, not a two-hour running batch. Tesla/other upstream access
failures are not fixed by this backpressure change.
