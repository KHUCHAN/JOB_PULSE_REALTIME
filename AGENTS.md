# Job Pulse agent rules

Collects US internship and co-op postings, reviews them, and emails one digest per run.

Read `WORKFLOW.md` first, then only the one doc you need. Do not scan the repo. Never read `../review-runtime/runs`, `../review-runtime/shadow-runs`, `../runtime-root`, `.codex_tmp`, `node_modules`, `.next`, `dist`, `output`. Use targeted `rg` and line ranges, not whole-file dumps.

## Hard rules
- `review-runtime/POLICY.md` is the authority for selection, dates, recipients. Do not restate it elsewhere.
- US only; exact 72-hour effective date; no year or score gate.
- At most one mail per run, no resends. Never retry an uncertain POST.
- Never reset dedupe state or held approvals.
- GitHub Actions is the only crawler. No bot-challenge bypass.
- No applying or messaging on platforms. LinkedIn: logged-out public pages only.
- Never print or log the review token.
- No `launchctl submit`; no new launchd jobs without approval.
- Cutover and rollback only via `review-runtime/transition.py`.
- A push to `main` triggers a production crawl: push once per change.
- Tests must remove their temp dirs. Do not delete user files without approval.

## Commands
- `node --test review-runtime/*.test.mjs ../review-runtime/community-{discovery,merge}.test.mjs`
- `npm test` / `npm run typecheck`
- `node review-runtime/review-run.mjs` (shadow only)
- `python3 review-runtime/snapshot-runtime.py --heartbeat <stamp>`, then `node review-runtime/compare-heartbeat.mjs <stamp>`
- `node review-runtime/coverage-check.mjs`
- `python3 review-runtime/transition.py cutover --dry-run` / `rollback --dry-run`
