# Job Pulse Realtime

Job Pulse Realtime is a personal job-monitoring console built with OpenAI Sites. The current slice combines a responsive demo UI with a Cloudflare D1 source catalog seeded from the verified public URL audit.

## Frontend routes

- `/` — operational overview, latest matches, source health, Talent coverage, and activity
- `/jobs` — keyword, status, arrangement, and location filtering with an accessible detail drawer
- `/sources` — official career-source health, adapter status, and crawl timing
- `/alerts` — keyword-rule creation, delivery mode, exclusions, and enable/disable controls
- `/talent` — provider-only directory of official Talent Community links and capabilities
- `/activity` — filterable event history with expandable technical details
- `/api/catalog` — paginated D1 source/Talent catalog (`q`, `talent`, `limit`, `offset`)

## Run locally

```bash
npm install
npm run dev
npm test
npm run build
npm run db:migrate:local
npm run db:seed:local
npm run db:verify:local
```

Node.js `>=22.13.0` is required.

## Current boundary

The operational job, alert, health, and activity screens still use sanitized in-memory demo records. The D1 catalog now persists 445 verified company sources, 444 career-posting URLs, and 109 Talent endpoints locally, and exposes them through `/api/catalog`.

The UI displays the planned automatic two-hour crawl cadence and has no manual crawl action. Source adapters, the deployed scheduler, conditional HTTP crawling, webhook events, and email delivery remain the next backend slices. Talent Harness only opens official employer pages; it never uploads or submits anything inside Job Pulse.

## Public-repository safety

Never commit resumes, application records, confirmation screenshots, personal contact information, credentials, raw email content, or unsanitized workbook exports. The checked-in fixtures contain public company names and career URLs only.

## Project shape

- `app/` — Sites/vinext routes, metadata, and global design system
- `components/` — application shell, fixture provider, and reusable UI primitives
- `features/` — route-level product screens
- `lib/` — domain contract, sanitized fixtures, and repository implementation
- `db/` and `drizzle/` — D1 schema, generated migration, and public source seed
- `design/concepts/` — approved visual direction used for implementation QA
- `.openai/hosting.json` — Sites capability declaration with the logical D1 binding `DB`

See [`docs/database.md`](docs/database.md) for the data flow and local D1 commands.
