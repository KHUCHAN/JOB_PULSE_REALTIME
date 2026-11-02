# Crawler performance and recovery history (Aug-Sep 2026)

Condensed from the dated crawl reports (originals only in `../review-runtime/doc-archive-20261102.tar.gz`). All benchmark numbers are local synthetic microbenchmarks, not production forecasts. Judge any change on the next naturally scheduled owner run; never start a duplicate crawl.

## Baseline and lessons
- Owner run was 43-52 min (Sep 5-8): native drain 28-40 min, ~1,230-1,600 source attempts, queue usually drained; the workflow failed only on recovery lanes (unresolved sources).
- Bottleneck is D1 writer queue and ingest, not upstream fetch or JS speed (e.g. Google 12s fetch, 42-85s writer wait, 24-55s ingest). More upstream concurrency worsens D1 overload.
- Latest observed (Sep 8): 34m42s total; native 27m46s, request recovery ~2m52s, browser recovery ~3m18s.
- GitHub can delay or drop scheduled runs; a stale "latest run" is a scheduling issue, not a slow batch.

## Changes made (and why)
- 0144: FTS update trigger compares old/new null-safe so unchanged upserts do not rewrite search rows (2,000 jobs: 55ms -> 3ms). Trigger from 0030 is immutable.
- Request recovery: shared 180s upstream budget per source; ingest has its own timeout; aborted/partial stays failed.
- Match deactivation: materialize incoming job/keyword tuples and probe the unique index (30k matches: 3,650ms -> 0.58ms).
- Browser recovery skips sources request recovery already persisted in the same workflow; missing handoff data never excludes a source.
- Topic/area/year reconciliation starts from incoming jobs via the source/URL unique index (1,250 jobs with obsolete memberships: 32ms -> 2.8ms).
- Request-recovery chunks pack up to 250 compact records within the 750,000-byte ceiling (3,419 Google rows: 35 -> 14 calls); browser recovery uses the same limits (253 -> 175 chunks). Two FIFO HTTP/D1 writers; up to 8 catalogs queued; at most 16 catalogs in flight.
- Collection slots (8) are separate from persistence; collection deadline starts after slot acquisition. TalentBrew uses three continuously refilled page workers. Talemetry stops launching windows after a missing page; only contiguous validated pages advance the checkpoint.
- `jobs.crawl_snapshot_hash` (nullable): identical stored input on an open job only touches presence/classification timestamps (250 parents: 25.5ms -> 0.64ms). Reuse lasts one UTC day; first crawl after deploy initializes hashes. Topic reconciliation still runs after every parent write.
- Owner pool backpressure: concurrency rises only after 3 clean rounds AND 30s since the last increase; after an error stays reduced >=60s; cooldown 5-30s; isolated success does not reset exponential cooldown.

## Recovery repairs (Sep 20)
- Reject escaped URLs, internal portals and deep individual job URLs as source roots (Google `/jobs/results/` catalog endpoint is allowed, nested jobs are not).
- Pinned public catalogs: AMD (Jibe API, 618), Loews (`loewshotels` Workday, 281), Sanmina (public Deltek/hrdepartment catalog, 754; validates table structure, range, stable total, distinct posting IDs; invents no dates).
- Native and HTTP probe stages share abort signals (incl. curl subprocesses); browser time reserved inside a 60s source lease; 8 browser workers; verified empty catalogs are separate from unresolved failures; the final workflow audit reconciles request failures against completed browser recovery.
- Alaska Air, Siemens EDA, Yum Brands: Jobsyn API can 403 from Worker egress; use the official sitemap as addition-only fallback, US/unknown/mixed roles only.

## Source recovery gates (every remaining broken source)
Official listing and job-detail URLs confirmed; bounded stable pagination; empty/malformed/blocked/truncated responses never close jobs; US scoping for global catalogs (unknown/mixed stay visible); tests, typecheck, lint, build pass; URL changes go in catalog, immutable migration and master workbook; recrawl shows healthy nonzero jobs. Open items then: Nardello (BambooHR `/careers/list`), Best Buy (ServiceNow portal widget), Sarcos/Palladyne (Cloudflare 403, keep its 13 stored jobs).

## Known limits (unfixed)
Tesla and other employer HTTP 403 blocks; Penn Medicine Talemetry 429 (page 13-16); Siemens 45s browser deadline; Sanmina catalog 403 again in Nov; Amkor/CGI empty responses; Applied Materials checkpoint nonprogress. These stay failures, never empty successes. A 30-day retention run deleted 1,000 jobs with backlog remaining; it drains over successive runs.
