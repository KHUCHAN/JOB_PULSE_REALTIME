# Job Pulse HTTP crawler

The crawler is a separate Cloudflare Worker. It uses HTTP `fetch` plus JavaScript parsers; it does not drive a browser, log in, solve CAPTCHA, upload resumes, or submit applications.

Every two hours (`0 */2 * * *`), the worker selects enabled D1 sources whose `next_crawl_at` is due, then processes up to 500 sources with eight concurrent requests. Each source writes a `crawl_runs` record, upserts open jobs into `jobs`, and receives its next two-hour run time. A failed source is isolated: its run is recorded as failed or blocked without stopping the rest of the batch.

## Adapters

- Greenhouse board URLs use the public `boards-api.greenhouse.io` JSON feed.
- Direct Workday URLs use the public Workday candidate-search JSON endpoint.
- All remaining official careers URLs use a lightweight HTML request and extract Schema.org `JobPosting` JSON-LD when present.

Only API feeds marked as complete may mark previously open jobs as closed. The HTML JSON-LD fallback never closes an existing job merely because a rendered page omitted it.

## Local verification

```bash
npm run crawler:dev
# In another terminal:
curl -X POST http://localhost:8787/__scheduled
```

`wrangler.crawler.local.jsonc` intentionally uses a local placeholder D1 id. Before production deployment, bind this worker's `DB` binding to the same deployed D1 database as the site, while retaining the same two-hour cron trigger.
