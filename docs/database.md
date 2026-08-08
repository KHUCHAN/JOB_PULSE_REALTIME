# Job Pulse database

Job Pulse uses one Cloudflare D1 binding named `DB`. The schema keeps source discovery, crawled jobs, keyword matches, delivery state, and the provider-only Talent directory separate.

`wrangler.local.jsonc` contains a placeholder database id for local D1 commands only. Sites injects the deployed D1 resource for the `DB` binding from `.openai/hosting.json`.

## Data flow

1. `sources` stores one verified company endpoint and the two-hour crawl schedule.
2. Each batch writes a `crawl_runs` record and upserts the current roles into `jobs`.
3. Matching writes one `job_matches` record per job and keyword rule.
4. Email or webhook delivery is recorded in `notifications`.
5. Verified Talent links are mirrored into `talent_targets`; `registration_runs` only records that the official site was opened or completed externally.

The seed contains public company names, verification metadata, career-posting URLs, and Talent URLs only. It excludes the source workbook and personal application data.

`GET /api/catalog` reads the D1 catalog with `q`, `talent=true`, `limit`, and `offset` query parameters. The response includes the current page plus URL-coverage counts.

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

The generated seed uses upserts, so refreshing verified URLs does not delete crawled jobs, matches, notifications, or external Talent history.
