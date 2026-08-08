# Job Pulse Realtime

Job Pulse Realtime is a personal job-monitoring console built with OpenAI Sites. This first slice is a polished, responsive frontend backed by sanitized in-memory demo data.

## Frontend routes

- `/` — operational overview, latest matches, source health, Talent tasks, and activity
- `/jobs` — keyword, status, arrangement, and location filtering with an accessible detail drawer
- `/sources` — official career-source health, adapter status, and crawl timing
- `/alerts` — keyword-rule creation, delivery mode, exclusions, and enable/disable controls
- `/talent` — assisted Talent Community registration queue with explicit user-only gates
- `/activity` — filterable event history with expandable technical details

## Run locally

```bash
npm install
npm run dev
npm test
npm run build
```

Node.js `>=22.13.0` is required.

## Demo-data boundary

This frontend does not crawl live career sites, send email, persist records, upload resumes, or submit Talent forms. `Crawl now` creates an in-memory demo event only. Changes reset when the preview reloads.

The next backend slices will add D1 persistence, source adapters and conditional HTTP monitoring, scheduling, internal webhook events, and email delivery. Those capabilities are intentionally separate from this frontend implementation.

## Public-repository safety

Never commit resumes, application records, confirmation screenshots, personal contact information, credentials, raw email content, or unsanitized workbook exports. The checked-in fixtures contain public company names and career URLs only.

## Project shape

- `app/` — Sites/vinext routes, metadata, and global design system
- `components/` — application shell, fixture provider, and reusable UI primitives
- `features/` — route-level product screens
- `lib/` — domain contract, sanitized fixtures, and repository implementation
- `design/concepts/` — approved visual direction used for implementation QA
- `.openai/hosting.json` — Sites capability declaration; D1 and R2 remain disabled for this slice
