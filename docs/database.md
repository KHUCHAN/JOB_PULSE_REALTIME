# Job Pulse database

Job Pulse uses one Cloudflare D1 binding named `DB`. The schema keeps source discovery, crawled jobs, keyword matches, delivery state, and the provider-only Talent directory separate.

`wrangler.local.jsonc` contains a placeholder database id for local D1 commands only. Sites injects the deployed D1 resource for the `DB` binding from `.openai/hosting.json`.

## Data flow

1. `sources` stores one verified company endpoint and the two-hour crawl schedule.
2. Each batch writes a `crawl_runs` record and upserts the current roles into `jobs`.
   A complete listing marks roles missing from the latest source response as `closed`; incomplete or browser-recovered listings never close unseen roles.
3. Matching writes one `job_matches` record per job and keyword rule.
4. Email or webhook delivery is recorded in `notifications`.
5. Verified Talent links are mirrored into `talent_targets`; `registration_runs` only records that the official site was opened or completed externally.

The seed contains public company names, verification metadata, career-posting URLs, and Talent URLs only. It excludes the source workbook and personal application data.

`GET /api/catalog` reads the D1 catalog with `q`, `talent=true`, `limit`, and `offset` query parameters. The response includes the current page plus URL-coverage counts.

## Filterable job data

`jobs` keeps the original title, URL, location, arrangement, employment type, summary, and timestamps plus structured detail fields when the source exposes them: description, responsibilities, qualifications, skills, department/team/business unit, job family/function, industry, office and secondary locations, normalized geography, salary range/currency/interval, benefits, education/experience, shift/travel/clearance/languages, requisition/apply URLs, source dates, and a bounded raw payload.

`source_facets` stores the source's own search controls and value counts (for example Workday job family/location, Phenom category/team/remote mode, Jibe category, and Eightfold business unit). When an ATS does not return native aggregations, the crawler derives useful facet values from structured jobs. Repeated crawls upsert facet keys idempotently. A per-source generation lease prevents an older overlapping crawl from deleting a newer facet snapshot.

The request crawler paginates supported ATS feeds. Phenom search pages use their embedded `totalHits`, `hits`, job payload, and aggregations, but only claim a complete listing when the unique normalized job count reaches the advertised total. Large Jibe catalogs are fetched in bounded concurrent pages and compacted before D1 persistence. Null fields are omitted and optional oversized content is reduced before strict 1.5 MB JSON batching so a single source stays within D1 memory, payload, and query budgets.

Chrome fallback is reserved for request-blocked or client-rendered sites. It preserves existing rich fields when a browser listing only returns basic anchors. A single source can be retried locally with:

```bash
BROWSER_FALLBACK_SOURCE_ID=source-id BROWSER_FALLBACK_ALL=1 npm run crawler:fallback:browser
```

## Local setup

```bash
npm run db:generate
npm run db:migrate:local
npm run db:seed:local
npm run db:verify:local
```

Rebuild the committed public seed from audited JSON exports by passing their paths:

```bash
npm run db:seed:build -- path/to/batch_1.json path/to/batch_2.json path/to/batch_3.json
```

For a catalog change, refresh the committed seed and create a new immutable data migration:

```bash
npm run db:catalog:refresh -- path/to/batch_1.json path/to/batch_2.json path/to/batch_3.json
```

This command refreshes `db/seed/*` and creates the next numbered `drizzle/*_refresh_sources_*.sql` migration only when the generated catalog SQL differs from a committed migration. Commit the migration, its journal update, and its advanced schema snapshot together. Never edit or replace a numbered migration that may already have run in production.

Refresh writers are serialized with an ownership lock and a journal compare-and-swap guard. A retry recovers locks owned by a dead process and removes only unjournaled artifacts at the next migration index before publishing a consistent replacement.

The generated catalog SQL uses upserts, so refreshing verified URLs does not delete crawled jobs, matches, notifications, or external Talent history.

Sites packages schema migrations separately because its migration files have a strict size ceiling. The bundled seed carries a deterministic SHA-256 version; on the first API request after deployment, `catalog_state` is compared with that version. A changed version upserts the source and Talent catalog in bounded batches and writes the marker last, so an interrupted refresh is retried on the next request without touching crawled jobs or user state.

`drizzle/0001_seed_sources.sql` initializes migration-managed D1 databases. Later refresh migrations apply the same upserts there; Sites deployments use the bounded runtime version sync described above.
