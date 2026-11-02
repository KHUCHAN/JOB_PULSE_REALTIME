# Round 3 — prepared, held before cutover

No transition, review/dispatch POST, mail, state reset/edit or live installation was performed. Legacy remains ACTIVE. Commands below are foreground reads/shadows only.

The compact legacy run directory is supplemented by exact, stable-read heartbeat JSON from the canonical `.codex_tmp` directory. Missing raw pages trigger an explicit reviewJobs re-fetch at the saved heartbeat snapshotAt; `--refetch` forces that diagnostic. The current server `unreviewed` predicate is omitted because it excludes subsequently delivered rows without time projection. Full saved decision scope and official evidence are retained; local history is projected strictly before runAt in memory. snapshotAt bounds firstSeenAt, not mutable catalog/body versions. Reports disclose any current official re-fetch and never claim a frozen pre-run state or original MIME.

Observed 084513 re-fetch: 453 raw rows versus legacy's 136 unreviewed rows; saved candidate details preserve the historical gate input. All 31 decisions (5 approve/26 reject) and all 5 selected IDs agree. All 5 legacy approved rationale strings match stored state. Three fresh rationale/projected-mail differences remain:

- Microsoft 28dff434: extra DB year/date metadata labels; prerequisite coursework omitted by the degree/enrollment extractor.
- Dodge & Cox a79ca2d9: graduate year, matriculation and office/hybrid caveats omitted by extraction patterns.
- Meta 01c27bb0: exact PhD caveat appended after authorization, changing order. No date-label difference was observed.

Each report retains both exact strings and both projected mail payloads, gate audits and cause. Missing caveats and non-keyword labels require repair and re-comparison before cutover. Current-code coverage evidence passes; transition derives its blocker from the observed comparison and cannot be cleared by editing a readiness file.

Community uses the same deterministic legacy discovery/merge helpers, with only output/checkpoint/ledger path adaptation. A network-denied replay of saved 084513 discovery repeats all three `Already in this run raw scan` exclusions (newExactDbRows=3). A current shadow actually executes discovery, merge, inbox and the combined source guard with POST0/LLM0. Inbox accepts only exact ID+official URL matches, excludes known identities, and routes every unsupported/unresolved item into explicit holds without stopping other rows. Non-empty unsupported fixtures were observed held; the real inbox was empty.

Daily scheduling calls platform-reconcile --publish-queue; the tracked queue is read by collect-platform-candidates.ts in production-crawl.yml. Only that owner ingests. The live review path does not call the platform LLM. Production artifacts show that owner step executed with an empty queue; contribution from a non-empty daily queue remains unverified.

Every direct/scheduled shadow or live invocation shares a retained fcntl lock. Live additionally requires authorization and assert-paused; shadow refuses a live-authorized root. Cutover prepares shadow disable/bootout while holding the same lock, before final snapshot/live installation. Rollback prepares checkpoint copy-back, refreshed shadow snapshot and shadow re-enable. None of those writes was exercised.

Live evidence is written into its run directory before any review transport: all raw pages, official bodies, source/checkpoint inputs, inbox holds, gate outputs, logs and uncertain-attempt receipts are retained. Its summary fields follow the legacy runbook (complete/hold, completion flag, timestamps, reviews/approvals/rejections, selected IDs, emailsSent and verification). The live summary and actual transport remain unobserved; no live execution was authorized.

Commands from the clone:
```sh
python3 review-runtime/snapshot-runtime.py --latest-heartbeat
node review-runtime/compare-heartbeat.mjs --snapshot-heartbeat --refetch
node review-runtime/coverage-check.mjs
python3 review-runtime/transition.py cutover --dry-run
python3 review-runtime/transition.py rollback --dry-run
```

SAS official pages showed 19/20/19 visible cards. The former equal-size comparison stopped at page two; a persisted later cursor could yield zero and a failure. The 07:02 failure scheduled 13:02 via the normal six-hour backoff. The source-specific fix collected 137 visible rows from nine official requests; uneven pages have neither completeListing nor a closure-cycle checkpoint. Other iCIMS tenants retain their old validation.

O'Reilly's GitHub browser artifact has 200 rendered rows, newest 2026-06-19, all outside retention. Its native checkpoint fix was already deployed in fca9f5c; the browser fallback obscured an unavailable native result. Mac official widgets/native recovery observed 1,993 rows including November 1, but the precise GitHub widget failure was not recorded and is still unverified. Keep widgets failures visible, disallow stale HTML fallthrough for that source, and add it to the existing owner's forced request lane for auditable results; no second crawler is introduced.

Sites production was observed on successful v328/fca9f5c (ancestor of main), lacking a3c1737's Sanmina status-write fix. Deployment and post-deployment row observations are recorded in the supervisor progress file.

Evidence size is measured without deletion by measure-evidence.py: current shadow files plus a live-source immutable generation (manifest/state/helpers/checkpoints/ledger), excluding legacy comparison copies. Actual future transport receipt bytes are unmeasured. Proposed retention only: 14–30 days raw evidence, 90 days summaries, durable state/held rationales/receipts indefinitely. No cleanup or retention job was added.
