# Supervisor commands (from the repo clone)

```sh
cd "$HOME/Library/Application Support/Job Pulse/repo"
# Foreground after each legacy heartbeat; no token copied, no canonical write:
python3 review-runtime/snapshot-runtime.py --heartbeat heartbeat-20261102T055005
# Offline, aligned to that heartbeat's saved scan boundary and clock:
node review-runtime/compare-heartbeat.mjs heartbeat-20261102T055005
# Read-only auth/runtime verification (foreground; launchd evidence already saved):
node review-runtime/verify-launchd.mjs
# Review-only transition plans; no automation/state/token changes:
python3 review-runtime/transition.py cutover --dry-run
python3 review-runtime/transition.py rollback --dry-run
```

For a later heartbeat, replace the exact heartbeat name in the first two commands. Missing saved selection/dispatch/scan evidence holds the comparison. A historical full pre-run state was not retained; the report discloses its current-state projection. The original 055005 selection is 0, and its aligned replay is 0. The report also explains all four differences in the saved 07:11 and 07:19 runs: one Microsoft row first appeared after the legacy snapshot, and the three undated Meta rows were absent from the legacy raw pages (the pre-policy helper used jobs/postedAfter, whereas later scans use reviewJobs). Those later runs are not aligned gate comparisons.

Do not execute cutover now. No live lane is installed, no token was copied and no automation was paused. The cutover dry run reports community, inbox and platform coverage readiness as missing; those cannot be asserted from the primary-only launchd shadow. The live runner deliberately holds on missing integration evidence or unprocessed inbox input. `coverage-readiness.json` must represent observed integration, not a bypass flag. Live dispatch permission/POST credentials, actual CAS transfer/rollback and first three delivery receipts remain untested. Separate supervisor go is still required after those gaps are reviewed.

The proposed live lane records an in-flight marker before the single dispatch-capable crawl check. Interrupted/uncertain runs stay held across process death. Review transport is capped at 100 rows, mail at one attempt and 500 IDs; the two existing verified helpers own fresh GET/durability checks. No dispatch-time URL-repair review POST is allowed by the guard. Exceptions use only the existing capped ephemeral runner. These live execution paths are written but have not been exercised against production.
