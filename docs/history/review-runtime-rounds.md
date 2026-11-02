# Review-runtime rounds 3-7 (2026-11-02)

Condensed from ROUND3-7_RESULTS.md (deleted; recoverable from `../review-runtime/doc-archive-20261102.tar.gz`). Round 2 commands stay in `review-runtime/ROUND2_COMMANDS.md`. Legacy automation stayed ACTIVE throughout; no POST, mail, cutover or live install happened.

## Round 3
- Comparison reads exact heartbeat JSON from canonical `.codex_tmp`; if raw pages are missing it re-fetches `reviewJobs` at the saved snapshotAt (`--refetch` forces it). History is projected strictly before runAt in memory; reports never claim a frozen pre-run state.
- Community discovery/merge reuse the legacy helpers (path adaptation only). Inbox accepts only exact ID+official URL matches; unsupported items become explicit holds.
- Shared retained fcntl `review-owner.lock` excludes shadow/live/transition overlap; live requires authorization and assert-paused; cutover disables and unloads shadow while holding it.
- SAS iCIMS pages are uneven (19/20/19): source-specific fix, no completeListing or closure checkpoint. O'Reilly: keep widget failures visible; no stale HTML fallthrough; in the owner's forced request lane.

## Round 4
- Evidence policy: undated unreadable official pages use fresh healthy collector fields; missing evidence, unhealthy source, stale confirmation, unparsed/relative dates, short text and oversized caveats hold. Labels come only from existing keyword functions.
- Caveat recall: of 295 stored sentences, 173 reproduced; 116 of 122 misses are absent from available text. Do not infer full historical recall.
- Crawl guard capped at 40 GitHub calls per live run incl. dispatch; rate limit skips dispatch but existing-data review continues. Live holds and a nine-hour missing-completion watchdog notify with fixed text and compact JSONL (`../review-runtime/live-status.jsonl`).
- O'Reilly: adapter tolerates reordered identical identity/date sets, fails changed sets with no jobs and no closure; real production churn unresolved.
- One-shot launchd diagnostics: temporary RunAtLoad true / KeepAlive false plist, bootout, confirm absence. Never `launchctl submit`.

## Round 5
- Empty/short-text reject->hold differences are listed per row; available-text changes block. Readiness is recomputed; hand-written acceptance flags cannot clear it. Stored non-relative official dates keep no fallback label.
- O'Reilly: deduplicated identity union across bounded pages and both heads; completeListing=false, no closure.
- 084513 comparison accepted; cutover and rollback dry runs: blockers=[], changesMade=false.
- Unverified: macOS notification display, deployed O'Reilly recovery, live transport/deliveries, installed watchdog.

## Round 6
- Fixes: separate policy-gate log, preflight routing, rollback refusal checks (inflight, hold, unresolved receipts, original SHA, record superset), crash-safe state writes (temp/fsync/parse/rename), journal phases resumable after side effects, PAUSED reasserted before every POST, sources GET non-OK = infrastructure hold, 404/410 always hold, exactly four unique required recipients, region via lib/job-region-classifier.
- Tests: live 33/33, transition 66/66. Latest comparison (145302) failed with 20 blockers, mostly verbatim-caveat failures.

## Round 7
- Root causes: abbreviation reduce joined newline-separated pieces (verbatim failures); broad travel/sponsor rules admitted headings/benefits/EEO; one approval held only for the 2000-char rationale limit (now approves at 1411 chars, optional caveats trimmed last-first, protected restrictions kept); selector now also accepts completed integrity-hold runs.
- Result: heartbeat 145302 accepted, blockers 0 (35/35 reviews, 19/19 selections). Heartbeat 175217 NOT accepted: 22 blockers (4 decision changes, missing PREFERRED MAJORS caveats, 3 keyword changes). Full runtime tests 153/153.
- Cutover remains blocked until a comparison is accepted and the supervisor gives a separate go.

## Test commands used
```sh
node --test review-runtime/*.test.mjs ../review-runtime/community-{discovery,merge}.test.mjs
npm run typecheck
node review-runtime/review-run.mjs
python3 review-runtime/snapshot-runtime.py --latest-heartbeat
node review-runtime/compare-heartbeat.mjs --snapshot-heartbeat
node review-runtime/coverage-check.mjs
```
