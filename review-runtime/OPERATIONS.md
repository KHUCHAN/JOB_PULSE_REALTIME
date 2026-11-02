# Shadow and daily discovery operation

Checkout: `~/Library/Application Support/Job Pulse/repo` (origin/main), outside iCloud. Durable state and token stay in `../review-runtime/config.local.json`. Snapshots go to `../runtime-root/current-snapshot` (hash-verified, foreground, read-only; no token mirrored). See [cutover manifest](CUTOVER_MANIFEST.md), [supervisor commands](ROUND2_COMMANDS.md), [round history](../docs/history/review-runtime-rounds.md).

## Commands
- `node review-runtime/review-run.mjs`: shadow only; crawler guard read-only (no `--dispatch`); no review/dispatch helpers. Guards deny Desktop access, Job Pulse POST and snapshot writes. Holds if the snapshot is missing/invalid. Output in `../review-runtime/shadow-runs/`.
- `node review-runtime/review-run.mjs --replay <saved-runtime-run>`: network-denied replay of saved scan/official bodies at the frozen clock; history projected to before runAt. Not a full historical identity-state replay.
- `--exceptions`: at most five identified error rows, <=6,000 input bytes + 20k context, no apps/plugins/shell/web, ephemeral structured JSON; only hold/evidence_only; usage recorded per exception. Normal path calls no LLM.
- Missing exact caveat text is appended to fresh shadow rationales only if it fits the endpoint limit; no truncation. Oversize/unsupported evidence is held.
- `python3 review-runtime/measure-runs.py`: metadata-only usage report. Three prompt-shrink runs still need measuring.

## launchd lanes (installed)
- `com.jobpulse.review-shadow`: local 01/04/07/10/13/16/19/22 at :10; persistent fcntl lock; shadow-only.
- `com.jobpulse.platform-daily`: 06:20 local, one ephemeral session per UTC day; normal Codex auth; input cap 300k/day, 20k context, <=6 web calls; over-limit output discarded; completed/unknown usage blocks another call.
- `scheduled-run.py` uses the Node/Codex binaries recorded in the plist EnvironmentVariables. Handshake/Muse need connected Chrome and stay in the legacy path.
- `com.jobpulse.review-live` is NOT installed (only at cutover: StartInterval=10800, RunAtLoad=false).
- Never `launchctl submit`. One-shot diagnostics: temporary RunAtLoad true / KeepAlive false plist, bootout, confirm absence.

## Daily discovery
LLM emits candidate JSON only. Code may resolve exact community list links, map a unique official source, and commit only `db/discovery/platform-candidates.json` (does not trigger a crawl push). The next admitted `production-crawl.yml` owner verifies official detail/identity/US evidence and DB presence, and alone may ingest a missing posting (OIDC, always an incomplete snapshot, no closures). Platform dates never become official dates; only official JobPosting JSON-LD parses, other formats hold. No platform mail.

## Live lane (proposed, unactivated)
- Crawl guard max 40 GitHub calls incl. dispatch; rate limit skips dispatch but review continues. In-flight marker before the single dispatch-capable check; uncertain runs stay held. Transport cap 100 rows, one mail attempt, 500 IDs. Status `../review-runtime/live-status.jsonl`; watchdog starts only after cutover.
- Readiness derives from code hashes and observed comparisons, not an editable flag. Phase 3 (writer/crawl-dispatch transfer) needs a separate supervisor go. Legacy automation stays active; rollback must preserve that.
- Retention proposal only: keep state, receipts, held rationales and code backups indefinitely; raw HTML/JSON 14-30 days; summaries 90 days. Nothing deleted yet.
