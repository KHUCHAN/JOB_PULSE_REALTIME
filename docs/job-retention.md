# 30-day posting retention

Production rollout was explicitly authorized after the initial code-only review.
Do not run the production runner locally: it owns crawling as well as maintenance.

## Policy

- Delete open and closed jobs whose valid `published_at` is at least 30 days
  old, inclusive, using the server's UTC clock. Unknown/unparseable posting
  dates remain; crawl timestamps and source-update timestamps are not substitutes.
- Archive compact identity/title/location, user review state, Codex review
  rationales and notification-item references first. The archive has no cascading
  foreign keys and intentionally omits descriptions and raw ATS payloads.
- Keep notification records and durable notification identity history. Backfill
  sent legacy notification identities before deleting job matches/items.
- Archive and delete in one atomic D1 batch. On failure neither operation is
  committed. Existing FTS deletion triggers remove the search index entries.
- A refreshed recent publication date is rechecked inside the deletion batch.
- Reject already expired incoming rows and archived identities before expensive
  classification. The SQL upsert also rechecks archive identities atomically.
  Full source-listing counts and completeness checks still describe upstream
  observations; created/updated counts describe retained rows only.
- Exact source/URL lookups return an explicit HTTP 410 for archived identities;
  the source verifier distinguishes intentional retention from missing ingestion.

## Owner workflow

`scripts/run-production-crawl.mjs` runs retention first with the existing GitHub
OIDC authentication. Each API call deletes at most 100 jobs; the sequential drain
has a two-minute wall budget and a 10-call/1,000-job ceiling. No additional crawler or
scheduled workflow is created. The existing crawl budget remains intact.

Errors and remaining backlog are printed in Actions output and its step summary.
Only actual maintenance errors set a failing exit code, without suppressing the crawl. An initial large
backlog may need more than one two-hour run; each subsequent run resumes until
no eligible rows remain. This does not promise an unbounded one-request purge.

Keep the last facet cache usable during deletion; do not cause public requests
to recompute the whole catalog after every chunk. The owner refreshes four
rotating facets once after a clean drain. Native requests start at two concurrent
leases, grow to four after clean rounds, and reduce concurrency with a bounded
cooldown after transport failures. Repeated capacity failures remain failures,
but finalization failure no longer prevents collecting the remaining diagnostics.

## Rollout order

1. Sites ships the additive, retry-safe `0143_retention_deployment_repair`,
   which covers the schema from immutable migrations 0140-0142 after the first
   rollout partially applied and failed on an existing index. Do not deploy
   the runner before the API/schema. Keep the site's public access unchanged.
2. Authenticated POST `purgeExpiredJobs` with `dryRun: true` is read-only and
   reports up to 100 eligible candidates, not total database size.
3. Let the existing workflow execute retention; do not start a duplicate crawl.
4. Inspect deleted counts/backlog and the first full collection/recovery run.

Deleted descriptions/raw payloads cannot be restored from the compact archive.
No production backup or rollback guarantee is implied. `SQLITE_NOMEM` indicates
a query-memory failure and does not establish that database storage is full;
retention is not proof that every memory-heavy query is fixed.
