# September 6 crawl latency follow-up

Production owner run 34012024070 used e4fe979c3253277ab9021469cb989349ae1334f1.
Its native drain took 40.28 minutes, attempted 1,226 sources and reached the
time limit without draining the due queue. Fifteen request errors included
repeated D1 overload responses. The entire workflow took 52m14s and failed
recovery, not the native job. Request recovery persisted Google (3,427 jobs),
NVIDIA (1,410), Microsoft (870) and Uber (143), among others.

## Confirmed defects repaired

- Non-program match deactivation used a correlated JSON EXISTS over the entire
  historical match table. The replacement materializes exact incoming
  job/keyword/generation tuples once and probes the existing unique index;
  already inactive matches produce no writes. No migration is necessary.
  Review decisions, notification eligibility and delivery history are untouched.
- Browser recovery could revisit a source already successfully persisted by
  request recovery in the same workflow because of its forced-native list.
  Tower Semiconductor, for example, succeeded with 83 jobs and was subsequently
  recorded as an empty-board failure. The same-run validated handoff now excludes
  successes before opening browser pages; failed and conflicting outcomes remain
  eligible. Missing handoff data never creates a success exclusion.

## Evidence and remaining limits

`node scripts/benchmark-match-deactivation.mjs` uses only an in-memory synthetic
SQLite database (30,000 matches, 500 input identities). Measured before: 3,650.59ms,
full match scan plus correlated subquery. After: 0.58ms, indexed tuple probes.
Both change exactly 500 rows. This is a query microbenchmark, NOT a measured
end-to-end production speedup. A regression test asserts the indexed query plan,
generation/keyword isolation, unchanged notification history and no replay writes.

The next scheduled owner run must validate total duration and queue drainage.
No manual crawl or duplicate workflow is started by this repair. HTTP 403
provider blocks (including Tesla), Penn Medicine's HTTP 429 pagination failure,
and other unresolved browser sources remain failures, not empty successes.
Access, recipients, review policy and retention policy are unchanged.

## First post-deploy owner run and next bounded improvement

Run 34028798351 (f4a27d6, 10:56:18–11:33:31 UTC) completed in 37m13s,
versus 52m14s in the preceding run. These runs differ in queue contents; this
is an observed duration comparison, not a controlled speedup benchmark.
The native drain now reports queue-drained=true in 28.34 minutes, attempting
1,460 sources with 1,433 successes, 18 failures, 9 blocks and 2 request errors.
Request recovery took 4m41s; browser recovery took 3m32s (excluding setup).

Google's 3,419 retained rows required 12.3s fetch, 84.9s ingest queue wait and
55.1s ingest. Apple waited 42.8s and Microsoft 35.1s. The next change packs
up to 250 compact request-recovery records per HTTP chunk instead of 100,
while retaining the exact 750,000-byte ceiling and two FIFO writer lanes.
Large descriptions still split at the byte ceiling. Browser recovery keeps
its existing defaults. The request log now includes ingestChunks so the next
scheduled run can measure the effect, without starting an extra crawl.

Regression fixtures preserve all 3,419 compact identities in 14 calls versus
35; this is a compact-record transport test, not Google's measured payload
or a claim of 60% faster production ingestion. Tests also cover multibyte
description bounds and stopping without finalization after a middle-chunk
failure. Official recency, locations, baseline protection, review decisions,
notification deduplication and recipients remain unchanged.

The workflow still correctly fails on unresolved sources: Penn Medicine's
reader returns HTTP 429 at page 13, and browser recovery sees HTTP 403.
Tesla and several other boards also return HTTP 403; Siemens hits its 45s
deadline; Sanmina's host fails DNS; Amkor has an unusable empty response.
These are not converted into successful empty catalogs by this optimization.
