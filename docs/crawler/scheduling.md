# Production collection scheduling

Sole crawler owner: `.github/workflows/production-crawl.yml` on `main`. Jobs: admission, crawl (drain plus retention), request-recovery, browser-recovery (ends with `scripts/summarize-recovery.ts`).

- Admission runs every 15 min (minutes 2/17/32/47) using `actions: read` history. Full collections are 2h apart, measured from the actual drain step start. A concurrency group serializes all lanes; every mutating lane requires admission.
- A recent successful drain suppresses another collection even if recovery failed. Failed drains back off 30 min. API/history errors fail closed. Push smoke runs are capped at 2 min and do not reset the clock.
- Missed-run check: `node scripts/check-production-crawl.mjs` (read-only). With `--dispatch` (once per heartbeat, authorized Sep 13) it waits 30 min past due, checks running/queued owners and that the admission guard is deployed, then requests the same workflow on `main` at most once. It never calls crawl endpoints. `dispatchRequested: true` means accepted, not completed. On an uncertain response inspect Actions history; do not retry.
- Skipped admission runs are normal. GitHub may delay or drop schedules.
- Test: `node --test tests/production-crawl-admission.test.mjs`
- A push to `main` triggers a production crawl.
