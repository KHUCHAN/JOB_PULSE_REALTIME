# Bounded collection/transport overlap

## Observed production evidence

Owner run 34063083984 (source b2a0f82) ran September 6 22:07:23–22:45:19 UTC
(37m56s). Native drain: 30.3 minutes, 1,491 attempts, queue drained, 10 request
errors. Eight errors explicitly reported D1 overloaded; two exceeded 55 seconds.
Request recovery succeeded, but browser recovery failed on unresolved sources.
The succeeding owner run 34068162377 was already active during this repair.
No duplicate crawl or manual workflow trigger was started.

Per-company request lane evidence:

| Company | Fetch | Writer queue | Ingest | Total |
| --- | ---: | ---: | ---: | ---: |
| Amazon | 32.0s | 67.4s | 45.7s | 146.2s |
| TikTok | 46.3s | 49.3s | 25.2s | 121.9s |
| Databricks | 0.7s | 46.5s | 15.4s | 62.8s |
| Synopsys | 85.7s | 0s | 1.3s | 87.9s |
| Arm | 64.9s | 0s | 2.3s | 67.9s |

These logs distinguish fetch latency from D1 queue pressure. They do not prove
that one page or one SQL query explains an entire company's fetch duration.

## Changes

- Separate request collection slots from persistence. Previously every source
  occupied one of eight upstream lanes through all queued writes and sample
  verification. Now up to eight collections run while completed catalogs save.
  At most sixteen catalogs are queued, fetching or saving together. The existing
  two FIFO HTTP/D1 writers, per-chunk byte/row bounds, source fetch deadline and
  final verification remain unchanged. Collection deadlines begin after a slot
  is acquired, not while waiting for it. Failures stay failures and are emitted
  exactly once; collection failure never enters persistence.
- Replace TalentBrew's three-page batch barrier with three continuously refilled
  page workers. One slow/retrying page no longer holds the two completed lanes
  idle. Preserve page caps, retry counts, ordered merge, exact cardinality checks,
  first-failed-page checkpoint and partial-snapshot closure protection.
- No location, official-date, review, email, deduplication or retention changes.

## Validation and limits

Deterministic tests prove bounded fetch/write/resident concurrency, output order,
failure isolation and settlement. A controlled four-catalog fixture falls from
230ms to 220ms with identical work; this is not an end-to-end production forecast.
A held TalentBrew page test proves later pages start before that page resolves
and still return the exact ordered complete catalog.

Measure the next scheduled owner run on the new source for actual wall time.
Existing upstream 403 blocks (including Tesla) and remaining source defects
are not fixed by scheduling improvements and must not be reported as healthy.
