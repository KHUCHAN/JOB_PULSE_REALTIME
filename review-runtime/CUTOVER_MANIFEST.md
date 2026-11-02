# Cutover manifest (no cutover performed)

Canonical original: `/Users/gimchan-yeong/Desktop/Desktop - 김찬영의 Mac mini/Job posting/JOB_PULSE_REALTIME`. New live root: `~/Library/Application Support/Job Pulse/runtime-root`. Shadow reads only `runtime-root/current-snapshot` (atomic pointer to an immutable generation; never opens canonical originals). The snapshot command reads stable bytes twice, checks stat/size/SHA-256, verifies the copy, and swaps only the pointer. Failed generations are kept. The legacy automation stays the only canonical-state writer until a separate supervisor go.

[Per-file SHA-256 inventory](CUTOVER_FILES.json): 702 entries (694 archived helper files, resume-match.ts, resolver anchor, durable state, source-observation/checkpoint files, applications ledger, token path). New code gets the root via `JOB_PULSE_PROJECT_ROOT`.

| Data family | Source | Live path | Shadow handling |
|---|---|---|---|
| reviewed/rejected/baseline/notified/held state | original `.codex_tmp/codex-direct-db-gmail-state.json` | same relative path under runtime-root | frozen bytes, never rebuilt |
| external Gmail exclusion receipts, review inbox files | original `.codex_tmp/` | same names | copied unchanged; token excluded |
| credentials | `.codex_tmp/review-inbox/.codex-review-token` | same path, 0600 | never copied or read |
| source epochs, community checkpoints | `../review-runtime/undated-source-observations.json`, `community-lookup-checkpoints.json` | `runtime-root/review-runtime/` | frozen copies |
| application ledger | project parent `applications/ledger.csv` | `runtime-root/applications/ledger.csv` | immutable copy |
| transient run files | `.codex_tmp/heartbeat-<stamp>*.json`, `../review-runtime/runs/<stamp>/` | `shadow-runs/<label>/` (evaluation), `live-runs/<label>/` (transport, uncertain attempts) | unique evidence dir; no state/token writes |
| attempt holds | none | `runtime-root/live-hold.json`, live-runs post-attempt JSON | uncertain POST never retried |
| live activation | none | `live-authorization.json`, `coverage-readiness.json`, `cutover-journal.json` | absent until reviewed cutover |

Outside Desktop and left untouched: `../review-runtime/` preload.cjs, archive.json, versions.json, resume-match.ts, node_modules, archived helper `.mjs`; `scripts/check-production-crawl.mjs`, `production-crawl-admission.mjs`, `production-crawl-limits.mjs`; GitHub CLI Keychain credential (read checks ran as KHUCHAN; dispatch permission untested); existing launchd plists; `~/.codex/sqlite/*.db`, automation TOML (transition CAS-updates status/updated_at only after a separate go). New live plist `~/Library/LaunchAgents/com.jobpulse.review-live.plist` is created only at cutover (StartInterval=10800, RunAtLoad=false).

Later rounds: `coverage-check.mjs` verifies current code hashes and observed shadow stages; no `coverage-readiness.json` assertion is consumed. A shared `review-owner.lock` excludes shadow/live/transition overlap; cutover disables and unloads shadow first. Live saves raw pages and gate evidence in live-runs. Unverified: token readability, authenticated POST, live pipeline, CAS cutover/rollback writes, first three deliveries. Scripts fail closed on missing readiness.
