# Crawl performance investigation, 2026-09-08

## Observed production baseline

GitHub Actions run `34187569899`, revision `578979162361e6fed1373c950b2975b98e8fdf68`:

- Workflow: 04:36:08–05:19:47 UTC, 43m39s; failure in recovery lanes.
- Native drain: 36.09 minutes, 1,605 attempts (includes checkpoint pages),
  1,570 successes, 20 failed, 15 blocked; 261,950 updated rows.
- Four explicit D1 queue-overload HTTP 500 responses around 04:57:47–50;
  six total request errors. Existing backpressure reduced concurrency to one.
- Request recovery: approximately 3m32s. Examples: Oracle 58s total,
  19s fetching and 32s waiting to ingest; Amgen 50s total, 13s fetching and
  32s waiting. Thus upstream speed is not the only bottleneck.
- Browser recovery: approximately 3m20s excluding setup. Bank of America
  inspected in 9.7s but spent 43.4s ingesting, including 26.9s writer wait.
- Penn Medicine failed at Talemetry page 15 with HTTP 429; Tesla returned
  HTTP 403; Siemens exceeded its 45-second browser budget. These are not
  fixed by adding more parallel requests or increasing timeouts.

## Implemented bounded database optimization

Area, program and recruiting-year reconciliation formerly compared candidate
membership pairs to an entire incoming snapshot using composite NOT IN.
Obsolete memberships caused quadratic scans. The replacement starts from the
incoming jobs, resolves each with the existing source/URL unique index, and
checks only that job's small set of desired topic keys. The final deletion
uses the existing job/topic primary key. No migration or new index is needed.

The optimization retains full reconciliation, including repairs after partial
failure. It does not skip fetching, discard companies, alter location/fit
criteria, change job details, alter retention, or touch notification decisions.

`node scripts/benchmark-topic-reconciliation.mjs` uses a synthetic in-memory
SQLite database (30,000 jobs), not production. Initial observed measurements:

| Input jobs | Obsolete memberships | Before | After |
| --- | --- | --- | --- |
| 250 | none | 0.914 ms | 0.448 ms |
| 250 | 250 | 2.018 ms | 0.655 ms |
| 1,250 | none | 2.814 ms | 1.315 ms |
| 1,250 | 1,250 | 32.062 ms | 2.766 ms |

Local timings are indicative, not a forecast of end-to-end production speed.
All 1,260 tests across 86 files, typecheck and production build passed.

## Remaining verification and external failures

Compare the next naturally scheduled owner workflow with this baseline; do not
start a duplicate crawl. At 08:18 UTC the latest Actions run was still the
04:36 run despite the enabled two-hour schedule, so missing schedule launches
must be distinguished from a slow running batch. No workflow was running.
Upstream blocks, reader rate limits and Siemens timeout remain unresolved.
The public audience, sender and all four recipients remain unchanged.
