# Supervisor commands (from the repo clone)

```sh
cd "$HOME/Library/Application Support/Job Pulse/repo"
python3 review-runtime/snapshot-runtime.py --heartbeat <stamp>   # foreground, after each legacy heartbeat; no token, no canonical write
node review-runtime/compare-heartbeat.mjs <stamp>                # offline, aligned to that heartbeat's saved scan and clock
node review-runtime/verify-launchd.mjs                           # read-only auth/runtime check
python3 review-runtime/transition.py cutover --dry-run           # plan only
python3 review-runtime/transition.py rollback --dry-run
```
Example stamp: `heartbeat-20261102T055005`. `--latest-heartbeat` replaces `--heartbeat <stamp>` for the newest one.

Missing saved selection/dispatch/scan evidence holds the comparison; the report discloses its current-state projection. Do not execute cutover without a separate supervisor go: coverage readiness (community, inbox, platform) must be observed, live POST permission is untested, and no live lane is installed. Later results: [round history](../docs/history/review-runtime-rounds.md).
