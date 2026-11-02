# 30-day posting retention

Do not run the production runner locally: it also owns crawling.

- Delete open and closed jobs whose valid `published_at` is >= 30 days old (inclusive, server UTC). Unknown/unparseable dates stay; crawl and source-update timestamps never substitute.
- Archive first (compact identity/title/location, user review state, Codex rationales, notification-item refs; no descriptions or raw payloads, no cascading FKs). Keep notification records and durable identity history; backfill sent legacy identities before deleting matches/items.
- Archive and delete in one atomic D1 batch; FTS triggers clear search entries. A refreshed recent date is rechecked inside the batch.
- Incoming expired rows and archived identities are rejected before classification (SQL upsert rechecks atomically). Exact source/URL lookups return HTTP 410 for archived identities.
- Owner: `scripts/run-production-crawl.mjs` runs retention first (GitHub OIDC): 100 jobs per call, 2-minute wall budget, ceiling 100 calls / 10,000 jobs, 1s pause. Backlog may need several runs. Only real maintenance errors fail the step; the crawl still runs. Legacy utility default is 10 calls.
- Keep the last facet cache usable; the owner refreshes four rotating facets once after a clean drain. Native leases stay <= 2, drop to 1 with bounded cooldown under pressure.
- Rollout: ship API/schema (`0143_retention_deployment_repair`, covers 0140-0142) before the runner; `purgeExpiredJobs` with `dryRun: true` is read-only (up to 100 candidates); let the existing workflow run retention; never start a duplicate crawl.
- Limits: deleted descriptions/raw payloads are unrecoverable; no production backup or rollback guarantee. `SQLITE_NOMEM` is a query-memory failure, not proof storage is full.
