# Production crawl speed audit — 2026-09-06

Evidence: GitHub Actions run 34051261622, source 8c8998c.

- Owner workflow: 18:17:51–19:01:39 UTC (43m48s), failure overall.
- Native drain: 35.81 minutes, 1,601 source attempts, 1,566 succeeded,
  18 failed, 17 blocked, 10 request errors. Queue drained. Repeated D1
  backpressure reduced four request lanes to one; do not increase concurrency
  indiscriminately. 30-day retention deleted 1,000; backlog remains.
- Request recovery: approximately 2m31s for 59 companies. IBM took 104s
  (89s fetching); TikTok 106s (60s fetching, 28s waiting); Amazon 90s
  (32s fetching, 22s waiting, 35s ingest). Google completed in 37s,
  NVIDIA 27s, Microsoft 12s. These are actual observations, not forecasts.
- Browser recovery: 109 sources, 80 nonempty recovered catalogs, zero
  persistence failures. Inspection passed 100 sources at 18:58:02 but job
  completion was 19:01:34. Saving only after inspection and small chunks
  contributed to the tail; the old writer pool leased entire catalogs.

## Applied changes

- Pack browser recovery using the existing tested 250-row/750,000-byte
  request-lane limits. Rich descriptions still split on bytes. Replay of
  the exact saved artifact (official-date retention at 18:57:23 UTC) keeps
  18,087 records while reducing 253 chunks to 175 (30.8%). This measures
  request reduction, NOT an asserted 31% end-to-end runtime improvement.
- Queue up to eight catalogs while retaining the configured three HTTP/D1
  writers. FIFO leases release after every complete response body; retries
  and large catalogs no longer own an entire writer lane. Result/status
  writes use the same cap. Cancellation and failure release capacity.
- Record per-company inspection, queue wait, write, ingest and chunk counts
  to distinguish fetching from persistence on the next owner workflow.
- Recognize the configured 45-second deadline as navigation_timeout.

## Still unresolved

The preceding workflow failed on real company issues; do not hide these by
marking jobs successful or deleting sources. Tesla and other upstream 403
responses remain access failures. Siemens timed out; Sanmina had a DNS
failure; Amkor and CGI returned unusable empty catalogs. Request recovery
also encountered Penn Medicine rate limiting, Applied Materials checkpoint
nonprogress, Eightfold 403s and CareFirst 403. Browser recovery did recover
some request-lane failures, but not all sources. No duplicate crawl or
manual workflow trigger was started for this change. Verify actual new
wall-clock timings from the next scheduled owner run.
