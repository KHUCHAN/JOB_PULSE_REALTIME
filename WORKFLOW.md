# Job Pulse workflow

## Pipeline
GitHub Actions `.github/workflows/production-crawl.yml` (admission, crawl, request-recovery, browser-recovery, summarize-recovery) -> production API (Sites + D1) -> review -> single Gmail digest. GitHub Actions is the only crawler. Details: `docs/crawler/scheduling.md`.

## Review lanes
- Legacy: Codex automation `job-pulse-2-hour-crawl`. Still ACTIVE and the only sender and canonical-state writer.
- Deterministic launchd lane in `review-runtime/`: `com.jobpulse.review-shadow` (every 3h, shadow only) and `com.jobpulse.platform-daily` (06:20 candidate discovery) are installed. `com.jobpulse.review-live` is NOT installed; it appears only at cutover, after a separate supervisor go.
- Daily Handshake stage, before `platform-run.mjs`: one `codex exec` call reads newest search results in the connected Chrome and writes them to `platform-runs/<day>/handshake/rows.json`; the model sees only a status and a count. `handshake-leads.json` lists rows missing from the DB. The platform run searches their official URLs, and only rows with an official URL on a known source reach the crawl queue. Failures never block the daily lane.
- Cutover status (Round 7): heartbeat 145302 comparison accepted; 175217 not accepted (22 blockers). See `docs/history/review-runtime-rounds.md`.

## Commands (from repo root; Python and Node as listed)
```sh
node review-runtime/review-run.mjs                                  # shadow run, POST 0
python3 review-runtime/snapshot-runtime.py --heartbeat <stamp>      # foreground snapshot after a legacy heartbeat
node review-runtime/compare-heartbeat.mjs <stamp>                   # offline comparison
node review-runtime/coverage-check.mjs
python3 review-runtime/transition.py cutover --dry-run
python3 review-runtime/transition.py rollback --dry-run
node scripts/check-production-crawl.mjs                             # read-only missed-run check
```
Data dir is the sibling `../review-runtime` (state, token, runs); never the repo's `review-runtime/` folder.

## Folder map
- `app/` routes and API (`/api/pulse`, `/api/catalog`) | `features/`, `components/` UI screens | `lib/` domain logic, crawler, classifiers
- `worker/` crawl store and scheduled handler | `scripts/` crawl runner, admission, benchmarks, audits
- `db/`, `drizzle/` schema, seed, immutable migrations | `build/` Sites packaging | `public/`, `design/` assets
- `tests/`, `test/` Node tests and setup (most tests sit beside code)
- `review-runtime/` deterministic review lane: POLICY.md, OPERATIONS.md, transition/snapshot/compare scripts
- `docs/crawler/`, `docs/database/`, `docs/history/` detail docs
- Ignore: `.codex_tmp`, `node_modules`, `.next`, `dist`, `output`, `.wrangler`, `.vinext`, `examples/`

## Which doc for which task
| Task | Open |
|---|---|
| Selection, date, recipient rules | `review-runtime/POLICY.md` |
| Run or inspect shadow, launchd, discovery | `review-runtime/OPERATIONS.md` |
| Snapshot, compare, cutover commands | `review-runtime/ROUND2_COMMANDS.md` |
| State and file paths for cutover | `review-runtime/CUTOVER_MANIFEST.md` |
| Past comparison results, test history | `docs/history/review-runtime-rounds.md` |
| Crawler behavior, adapters, review feed | `docs/crawler/overview.md` |
| Workflow schedule, admission, dispatch | `docs/crawler/scheduling.md` |
| Reader proxy usage | `docs/crawler/reader-inventory.md` |
| Schema, seed, migrations, backfills | `docs/database/schema-and-seed.md` |
| 30-day retention | `docs/database/job-retention.md` |
| Why the crawler is slow, past fixes | `docs/history/crawler-performance.md` |
| Original product/filter design | `docs/history/design-decisions.md` |
