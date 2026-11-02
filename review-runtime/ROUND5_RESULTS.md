# Round 5 results

1. Comparison class DONE — `4b1fc56`: observed empty/short-text reject→hold explanations are listed per row; available-text changes block. Transition readiness recomputes acceptance; hand-written acceptance flags cannot clear it.
2. Dated collector evidence DONE — `4b1fc56`: stored non-relative official date retained without fallback label, including read-only dispatch. Recent/old/relative/empty-text fixtures pass.
3. O’Reilly DONE — `99c8be8`: deduplicated valid identity union across bounded pages and both heads; churn diagnostics reach recovery artifacts; completeListing=false, explicit no-closure authority. Other adapters retain their checks.
4. Notification DONE — `6c71edb`: exactly one foreground `localNotify("test")` call, fixed text “This is a Job Pulse test notification.” Command returned `{"exitCode":0,"stdout":"","stderr":""}`; no email.
5. Validation observed: 35 Node tests, 553 crawler/runner/recovery tests and typecheck passed; current-code shadow completed with POST0, LLM0, snapshotStateUnchanged=true.
6. 084513 comparison accepted: six explained undated differences, three explained missing-text holds, zero blockers; no caveat-recall rework.
7. Missing-text row: `34567c79-d95c-4d13-9660-0b84ff0df7c0`, textLength=0, legacy missing-evidence failed list observed.
8. Missing-text row: `1403dbcb-f803-48f3-82ba-8c989d83656b`, textLength=0, legacy missing-evidence failed list observed.
9. Missing-text row: `ab9f4cae-06d2-4c52-8f66-b34f49cc758d`, textLength=0, legacy missing-evidence failed list observed.
10. Cutover and rollback dry runs: blockers=[], changesMade=false, legacy automation ACTIVE; remaining cutover blockers from these dry runs: NONE.
11. Unverified: visual macOS notification display, deployed O’Reilly recovery, live transport/deliveries and installed watchdog; no live lane or cutover exercised.
12. Evidence: `../review-runtime/round5-{tests,crawler-tests,recovery-tests,typecheck}.log`, `round5-{notification,shadow,comparison,cutover-dry-run,rollback-dry-run}.json`; shadow `shadow-heartbeat-20261102T110907-1793617747542`, replay `replay-heartbeat-20261102T084513-1793617792008` under `../review-runtime/shadow-runs/`.
13. POLICY untouched; no persist/dispatch POST, mail, state edits, deletions, automation stop, live invocation, execution flag or launchctl submit. Legacy heartbeat left alone.
