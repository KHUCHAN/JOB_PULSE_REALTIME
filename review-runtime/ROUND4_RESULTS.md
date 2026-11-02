# Round 4 — held before cutover

No review/dispatch POST, mail, state replacement/reset, file deletion, POLICY edit, automation pause/resume, live installation or transition execution. Runtime evidence is in `../review-runtime/round4-*`; these paths are relative to the checkout. Two temporary one-shot preflight plists used RunAtLoad true / KeepAlive false and were booted out; both removals were confirmed. The first 10:47:05 check still encountered the rate limit; the actual post-reset 10:47:38 check passed. No launchctl submit was used.

The deterministic evidence policy now uses fresh healthy collector fields for undated unreadable official pages. The archived identity/deduplication exclusions remain; archived company caveat and evidence rejection branches do not run. Missing evidence, unhealthy sources, stale collector confirmation, unparsed or relative dates, short text and oversized exact caveats hold without a review. Existing keyword functions alone supply labels. A final read-only dispatch adapter applies the same policy and generic exact caveat completeness to fresh rows before the archived transport; its syntax and injected GET fixtures were tested without transport. Actual live operation remains unobserved.

Fixtures taken from saved 084513 stored text approve 379f22ad, 72092224, 0eab52bd, ff96a14c and 873cfd91 with the collection-date disclosure; Markham e28b6383 rejects as Canada despite the bad stored country. No keyword fit rejects only after sufficient available text; empty/short evidence holds. IBM stored descriptions are abbreviated; these fixtures establish the requested policy behavior, not the availability of omitted caveats.

Recall: 60 recent durable approved rows, 295 stored caveat sentences, 173 reproduced. Of 122 misses, 116 exact sentences are absent from available saved/DB text, and six are historical non-restriction prose. Among 179 sentences present in available text, 173 are reproduced. Every miss, class and exact sentence is retained in `../review-runtime/round4-caveat-recall.json` and `round4-caveat-misses.md`; available DB text is cached in `round4-caveat-text.json`. No company name was added to the extractor. Do not infer full historical caveat recall from this partial text.

The aligned 084513 comparison has six explained undated reject→approve differences (the five requested rows plus df7f0135). Both outcomes and audits are retained. All five original approvals preserve their legacy caveat sentences, keyword labels and date labels; 11 extra verbatim caveats are listed. Three dated News Corp rows (34567c79, 1403dbcb, ab9f4cae) change reject→hold because both page and DB descriptions are empty. The observed comparison blocks cutover on these three differences. No manual readiness assertion can clear it, and current code hashes bind the shadow and comparison. Original durable rejections are not retrospectively reviewed.

The crawl guard permits at most 40 GitHub calls per live run, including dispatch, and its result is reused by the review stage. Observed read-only checks used 9 calls after reset; the rate-limited shadow used 2 calls, skipped dispatch and completed existing-data review. Fixture 403 handling uses 1 call and no dispatch. Actual live dispatch call count is not observed. Preflight reports hold-rate-limited distinctly; transition audits unexpected/KeepAlive jobs. Only review-shadow and platform-daily are loaded, neither KeepAlive.

Live holds/failures and a nine-hour missing-completion watchdog use fixed local macOS notification text and compact deduplicated JSONL status. Fixture notification sinks and watchdog timing were checked; startup/timeout notification integration is prepared but not exercised end to end; actual macOS notification delivery and installed live/watchdog behavior remain unobserved. Watchdog installation is only a prepared cutover step.

Production run 41429715718 at a009190 completed failure. Request artifact 13133533880 reports exactly: `O'Reilly newest window changed during pagination.; retry: O'Reilly newest window changed during pagination.` Browser artifact 13133424787 contains Intel only. SAS was not attempted; its DB row still shows last check 07:02Z, 230 jobs, failed, next due 13:02Z. Sanmina is unchanged: stale, 425 jobs, last checked October 14; request recovery reports migrated public catalog HTTP 403.

A bounded ordinary official Mac crawl reproduced O'Reilly's changed identity/date set with total 19069 and two unique 500-row heads, in five requests. The adapter now tolerates reordered identical identity/date sets and emits exact count/set diagnostics, while still failing changed sets with no jobs and no closure. Three targeted crawler fixtures pass. This does NOT establish O'Reilly production recovery; the true churn remains unresolved, and GitHub egress was not shown blocked.

Validation evidence: `round4-tests.log`, `round4-typecheck.log`, `round4-oreilly-tests.log`, `round4-final-shadow.json`, `round4-coverage.json`, `round4-cutover-dry-run.json`, `round4-rollback-dry-run.json`, `round4-preflight-after-reset.json`, and the latest replay's `aligned-comparison.json`. The final current-code shadow completed with POST0, LLM0, unchanged snapshot state; both dry runs made no changes. Cutover dry run reports the three comparison blockers; rollback preparation has no blockers. No later legacy heartbeat had completed when checked.

Supervisor read-only commands, from the checkout (run sequentially because they share the owner lock):
```sh
node --test review-runtime/{date-policy,policy,runner,operations,comparison,dispatch-policy}.test.mjs
npm run typecheck
node review-runtime/review-run.mjs
node review-runtime/compare-heartbeat.mjs --snapshot-heartbeat
node review-runtime/coverage-check.mjs
python3 review-runtime/transition.py cutover --dry-run
python3 review-runtime/transition.py rollback --dry-run
```
For a later completed heartbeat, foreground snapshot it with `python3 review-runtime/snapshot-runtime.py --latest-heartbeat` before comparison. Do not execute cutover. Read-only live dispatch adapter syntax: use the same preload/guards as the preflight and mode `check`; never invoke the live runner as a diagnostic.

Cutover recommendation: NO. Resolve or explicitly adjudicate the three dated missing-text decision differences through an evidence-backed policy/acceptance change; recover sufficient text to assess historical caveat gaps; validate real notification delivery and the production O'Reilly/SAS fixes. Live transport, first three deliveries and watchdog installation remain reserved for separately authorized cutover.
