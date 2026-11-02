# Job Pulse Realtime

Personal job-monitoring console (Sites/vinext + Cloudflare D1) with a GitHub Actions crawler and a review lane that emails one digest of US internship and co-op postings.

- Agents: read [AGENTS.md](AGENTS.md), then [WORKFLOW.md](WORKFLOW.md). Detail docs live in `docs/`.
- Routes: `/` overview, `/jobs`, `/sources`, `/alerts`, `/talent`, `/activity`, `/api/catalog`.

```sh
npm install        # Node >=22.13.0
npm run dev
npm test
npm run build
npm run db:migrate:local && npm run db:seed:local && npm run db:verify:local
```

Never commit resumes, application records, screenshots, contact details, credentials, raw email or unsanitized workbook exports. Fixtures hold public company names and career URLs only.

Database and seed: [docs/database/schema-and-seed.md](docs/database/schema-and-seed.md).
