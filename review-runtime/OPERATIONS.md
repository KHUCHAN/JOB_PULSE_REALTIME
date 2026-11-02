# Shadow and daily discovery operation

The checkout is `~/Library/Application Support/Job Pulse/repo` (origin/main), outside iCloud. Original durable state and token remain at the canonical project path in `../review-runtime/config.local.json`. No copies or replacement state are used.

- `node review-runtime/review-run.mjs`: shadow only; crawler guard is read-only (no `--dispatch`), review/dispatch helpers are absent. Existing automation remains the only review/email writer. Every child has a guard denying Job Pulse POST and canonical state writes. Inputs/outputs live in `../review-runtime/shadow-runs/`.
- `node review-runtime/review-run.mjs --replay <saved-runtime-run>`: network-denied gate replay using saved scan/official bodies and frozen run clock. Current append history is projected to before runAt in memory. A frozen full pre-run history was not retained, so this is not a complete historical identity-state replay. Raw run originals are unchanged.
- The normal path calls no LLM. `--exceptions` permits at most five identified error rows, each with <=6,000 input bytes plus a 20k context, no apps/plugins/shell/web, ephemeral structured JSON. Only hold/evidence_only is allowed; deterministic verification still owns selection. Usage is recorded per exception, never as a review.
- Exact missing caveat text is appended only to fresh shadow rationales if it fits the endpoint limit. No truncation and no persisted amendment. Oversize/unsupported evidence remains held.
- `python3 review-runtime/measure-runs.py`: metadata/JSON-only usage report. No rollout access. Three scheduled prompt-shrink runs still need measurement; no inference from prompt length to billed savings.

Registered launchd lanes (plist syntax checked; bootstrap succeeded):

- `com.jobpulse.review-shadow`: local hours 01/04/07/10/13/16/19/22 at :10, every three hours. Persistent fcntl lock; output in runtime. Scheduled runs are shadow-only. Two manual live shadows completed before installation.
- `com.jobpulse.platform-daily`: 06:20 local, one new ephemeral session per UTC day; same lock discipline. Auth is normal existing Codex auth. No user browser settings were changed. Completed/unknown daily usage prevents another token-consuming call. Input cap 300k/day, context 20k with at most six web calls for future runs; actual usage ledger is authoritative and an over-limit output is discarded.
- `scheduled-run.py` invokes the exact Node/Codex binaries recorded in launchd EnvironmentVariables; PATH includes gh. Handshake/Muse require connected Chrome and remain enabled in the legacy path until verified daily coverage exists.

Daily discovery: LLM emits candidate JSON only. Code may resolve exact community list links, map a unique existing official source, and commit only `db/discovery/platform-candidates.json`. That path alone does not trigger a crawl push. The next admitted `production-crawl.yml` owner verifies official detail/identity/US evidence and exact DB presence. Only that existing owner can ingest a missing posting via existing OIDC transport, always incomplete snapshot (no closures). Platform dates never become official dates. Current API parser supports official JobPosting JSON-LD; other formats hold. No platform-specific review or mail is sent.

Phase 3 is intentionally absent. Supervisor go and a separate authorized handoff are required before any writer/crawl-dispatch transfer. Existing automation is active, its target thread and recipients unchanged. Neither these jobs nor queue publication pauses it. Rollback of a future transition must preserve this boundary; no current rollback/destructive cleanup was performed.

Retention proposal only: preserve durable state, receipts, held rationales and original code backups indefinitely; consider 14–30 days raw HTML/JSON and 90 days summaries, compressed read-only evidence after approval. No file has been deleted or archived by this task.
