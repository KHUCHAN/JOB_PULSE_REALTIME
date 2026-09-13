# Production collection scheduling

The sole crawler owner remains `.github/workflows/production-crawl.yml` on
`main`. GitHub checks admission every 15 minutes (minutes 2/17/32/47). Normal
full collections remain two hours apart, measured from the actual drain step
start, not from workflow creation, skipped checks, or email activity.

`admission` reads Actions history with `actions: read`. The workflow concurrency
group serializes admission, drain, retention and both recovery lanes together.
Every mutating lane requires admission. A recent successful drain suppresses
another full collection even when its later recovery jobs failed. Failed main
drains have a 30-minute retry backoff; API/history errors fail closed. Push smoke
runs stay bounded to two minutes and do not reset the full-collection clock.

## Independent missed-run check

From this checkout, run `node scripts/check-production-crawl.mjs` for a read-only
decision. The existing Codex heartbeat may run it with `--dispatch` once per
heartbeat, following the user's September 13 authorization to repair missed
collections. It grants the native scheduler 30 minutes beyond the next due time,
checks for running/queued owners, checks the remote admission guard is deployed,
then requests the **same workflow** on `main` at most once. It never calls crawl
endpoints directly. No cron, LaunchAgent or second crawler is installed.

`dispatchRequested: true` means accepted dispatch, not completed collection.
Inspect the new run's admission, drain, and recovery jobs separately. On an
uncertain dispatch response, inspect Actions history; do not blindly retry.
Routine skipped admission runs are expected and are not failures or successful
collections. GitHub can still delay/drop schedules; the independent heartbeat
depends on the user's Codex host and GitHub login being available.

Validation: `node --test tests/production-crawl-admission.test.mjs`.
Public site access, source selection, DB retention, Gmail sender/recipients,
72-hour official posting age, and reviewed/notified identities are unchanged.
