# Job Pulse database (Cloudflare D1, binding `DB`)

`wrangler.local.jsonc` holds a placeholder id for local commands; Sites injects the real D1 from `.openai/hosting.json`.

## Tables
- `sources`: verified company endpoints and crawl schedule. `crawl_runs`: one per batch.
- `jobs`: title, URL, location, arrangement, structured detail fields (description, qualifications, skills, team, salary, requisition/apply URLs, dates), bounded raw payload, `location_region` (us/non_us/mixed/unknown), `crawl_snapshot_hash`.
- `job_matches` (job x keyword rule), `notifications`, `talent_targets` / `registration_runs` (provider-only; only records that the official site was opened).
- `source_facets`: source search controls and counts; derived from structured jobs when the ATS gives none; per-source generation lease stops old crawls deleting newer facets.
- `job_topics`: deterministic membership (`ai-data`, `area:ai-ml`, `area:data-analytics`, `area:software-engineering`), index `(topic_key, job_id)`. `topic_classified_at` / `area_classified_at` keep backfills bounded and resumable.
- Complete listing closes missing roles; incomplete or browser-recovered listings never close.
- Seed holds public company names, URLs and Talent URLs only. `GET /api/catalog` params: `q`, `talent=true`, `limit`, `offset`.

## Crawl payload limits
Phenom completes only when unique jobs reach advertised `totalHits`. Large Jibe catalogs are paged concurrently and compacted; nulls omitted and optional content shrunk before strict 1.5 MB JSON batches (D1 memory/payload limits). Browser fallback keeps existing rich fields when it only returns anchors.

## Backfills (private API actions)
- `backfillJobTopics`: at most 500 pending open jobs per call.
- After migration 0045: call `backfillJobAreasAndRegions` with `limit: 500` sequentially until `remaining` is 0, then `refreshJobFilterOptions`. Use the existing Sites SIWC bypass token from `get_site`; do not generate or rotate it or change site access.

## Commands
```sh
npm run db:generate && npm run db:migrate:local && npm run db:seed:local && npm run db:verify:local
npm run jobs:topic:audit -- /abs/path/job-pulse.sqlite   # read-only; JOB_PULSE_KNOWN_AI_DATA_TITLES fails on missing roles
npm run db:seed:build -- batch_1.json batch_2.json batch_3.json
npm run db:catalog:refresh -- batch_1.json batch_2.json batch_3.json
npm run sites:stage -- /new/staging-dir [/abs/sites/scripts/package-site.sh /abs/archive.tar.gz]
```

## Rules
- Never edit a numbered migration that may have run in production. `db:catalog:refresh` writes `db/seed/*` and the next `drizzle/*_refresh_sources_*.sql` only if the catalog changed; commit migration, journal and snapshot together. Upserts never delete jobs, matches, notifications or Talent history.
- Sites migrations have a size ceiling: the bundled seed has a SHA-256 version and `catalog_state` is compared on the first API request; changes upsert in bounded batches, schedule only changed sources for immediate crawl, and write the marker last.
- Package only through `sites:stage` (rejects initial seed, `*_refresh_sources_*.sql` and superseded 0140-0142 DDL). Never pass the checkout to the generic package helper.
- `drizzle/0001_seed_sources.sql` initializes migration-managed databases.
