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
