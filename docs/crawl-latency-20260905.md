# Crawl latency repair, September 5, 2026

## Production evidence before this change

Owner workflow 33983630853 (d685f983b50699b9b958d9bfd311560e2409ada1):
- Native collection: 40.56 minutes, 1,285 attempts, 1,265 successes, 184,020 updates;
  the due queue did not drain. D1 backpressure reduced concurrency repeatedly.
- Entire workflow: 18:18:08–19:10:18 UTC (52m10s), failed recovery lanes.
- Google: fetch 13,568ms, ingestion wait 64,439ms, ingestion 55,914ms.
- Amazon: fetch 30,908ms, wait 73,154ms, ingestion 38,676ms.
- IBM: fetch 95,051ms; upstream latency is independently material.
- Penn Medicine: reader HTTP 429 at page 16; not an empty catalog.

## Changes

1. Bounded migration 0144 replaces only the FTS update trigger, without an index
   rebuild or job deletion. Null-safe old/new comparisons avoid deleting and
   reinserting identical search content on every crawl. Freshness, retention,
   real content changes, inserts, deletes, review and notification state remain
   unchanged. The existing trigger is immutable in migration 0030.
2. Request recovery shares a 180-second upstream budget across pages and retry
   attempts. Adapter timeouts are preserved. Aborted/partial collection remains
   failed and is handed off through the existing recovery mechanism; it is not
   published as complete. Already collected valid snapshots have a separate
   ingestion timeout so DB queueing cannot consume the fetch budget.
3. Talemetry stops launching later windows after a missing page. Only contiguous
   validated pages may advance the checkpoint. Later pages could not contribute
   to that checkpoint anyway; retry/closure completeness safeguards remain.

## Verification

- 82 test files / 1,233 tests passed, typecheck and production build passed.
- Search tests cover all five indexed fields, NULL transitions, unchanged
  upserts, insert/delete, replay and FTS integrity. Budget tests cover shared
  cancellation, adapter cancellation and separation from ingestion. Talemetry
  fixture retains 400 valid jobs, page-5 checkpoint and incomplete status when
  page 5 is rate limited, without requesting pages 6–46.
- Local in-memory SQLite microbenchmark, 2,000 unchanged jobs with approximately
  6KB descriptions: 55ms before / 3ms after; total_changes including a final
  integrity command 11,856 before / 2,001 after. This is not an end-to-end
  production speedup claim. Measure the next scheduled owner run separately.
- No manual crawl, email dispatch, access-policy or recipient mutation is part
  of this repair. Provider 403/429 failures are not claimed fixed by this patch.
