# Unchanged-parent persistence optimization — 2026-09-08

## Production evidence

GitHub owner run `34168040937`, source `eeb8a88`, completed in 42m58s.
The native drain took 35.55 minutes: 1,578 attempts, 250,007 existing-row
updates, three request errors. One explicit failure was `D1 DB is overloaded.
Requests queued for too long.` The run ended as failure, not healthy.

| Source | Collection | Writer queue | Write time |
| --- | ---: | ---: | ---: |
| Google | 15.225s | 66.389s | 23.482s |
| Databricks | 0.676s | 88.691s | 16.231s |
| NVIDIA | 18.012s | 23.523s | 9.684s |
| Stripe | 0.533s | 20.330s | 3.315s |

The crawler is Node.js/TypeScript plus browser recovery. These examples are
primarily storage/queue bottlenecks, not slow JavaScript execution or official
page download. Raising concurrency would worsen the observed D1 overload.

## Change

Add nullable `jobs.crawl_snapshot_hash` with one bounded additive migration.
Hash all bounded input fields and classification results, excluding only
random IDs and local observation timestamps. Newly added fields automatically
participate. Reuse lasts at most the UTC day; the next day's first observation
performs a full write. The first crawl after deployment initializes hashes.

When the exact same input is already stored and the job is open, update only
presence/classification timestamps. Do not resend rich descriptions or rewrite
indexed content columns. Changed content, pay, country, official timestamps,
requirements, URLs, missing hashes, and reopening use the full existing path.
Topic reconciliation still executes after every parent write, so partially
failed topic batches remain repairable. First-seen, review, baseline, delivery,
reopening generation, retention and closure guards remain unchanged. The legacy
`updated` counter still counts observed existing rows, not changed descriptions.

## Validation

- 85 test files / 1,257 tests pass; typecheck and production build pass.
- Actual new migration/upsert/touch SQL tested against the existing job schema
  snapshot with FTS integrity verification. Covers changed fields, old NULL
  hashes, closed jobs, UTC day rollover and topic reconciliation.
- Reproducible microbenchmark:
  `JOB_PULSE_BENCHMARK=1 npx vitest run worker/crawl-store.test.ts -t presence-only --silent=false --reporter=verbose`
- 250 unchanged parents, 24 job indexes, FTS triggers, roughly 4KB descriptions:
  full upsert 25.481ms vs timestamp update 0.636ms (five-repeat local mean).
  Parent SQL JSON parameter 1,436,531 bytes vs URL list 8,891 bytes.
  This is a local parent-write benchmark, NOT end-to-end production improvement;
  it excludes HTTP collection/ingest transport, classification and topic writes.

## Remaining operational problems

Tesla and several other sites still reject upstream requests with HTTP 403;
Siemens hit its 45-second browser deadline. This change does not claim those
access failures are fixed. Latest visible owner workflow remained Sep 7 22:50Z
despite the active two-hour schedule; missing ticks are separate from runtime.
No manual or duplicate crawl, access change, mail recipient change, historical
review replay, or data purge was initiated for this deployment.
