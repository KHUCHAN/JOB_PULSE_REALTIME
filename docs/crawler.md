# Job Pulse HTTP crawler

The production crawler runs inside the Sites API and uses HTTP `fetch` plus JavaScript parsers. It does not log in, solve CAPTCHA, upload resumes, or submit applications. GitHub Actions is the production scheduler: `.github/workflows/production-crawl.yml` starts every two hours and drains due sources through the authenticated `scheduledCrawlBatch` action with at most two concurrent requests.

The scheduler authenticates without a stored shared secret. GitHub issues a short-lived OIDC token whose signature, audience, repository, branch, workflow path, and event are verified by the Sites API. The runner refreshes that token during long drains. A workflow concurrency group prevents two scheduled drains from overlapping.

Each request leases one due source, writes a `crawl_runs` record, upserts open jobs, and schedules the next check. Successful sources are due in two hours, failed sources in six hours, and access-blocked sources in 24 hours. One broken or slow source therefore cannot stop the remaining queue. A run stops once the queue is drained or its bounded 20-minute window expires; the next two-hour run continues the remaining due queue. Resume-match email planning and delivery runs once after the drain, rather than after every source request.

## Adapters and discovery

- Native JSON/API adapters cover Greenhouse, Lever, Workday, Ashby, SmartRecruiters, Workable, BambooHR, Oracle, SuccessFactors, Phenom, Eightfold, ADP, UKG, Avature, Paylocity, and other verified first-party feeds.
- Official careers landing pages are fetched once and inspected for public ATS links, including URLs escaped inside JavaScript application state.
- Cross-domain follow-up is allowed only for allow-listed public ATS catalog hosts linked by the official page. Login, talent-community, alert, application, and individual job-detail routes are rejected as source replacements.
- Schema.org `JobPosting`, server-rendered listings, sitemaps, and bounded reader fallbacks cover sites without a usable ATS API.

Only an authoritative, fully enumerated API or sitemap cycle may mark unseen jobs closed. Partial landing pages and fallback results can add or update jobs but cannot close records omitted from that response.

## Operations

The workflow may also be started manually from GitHub Actions. Its summary records attempted sources, status counts, job changes, elapsed time, whether the due queue drained, and the final source-health distribution.

The Codex two-hour automation is monitoring-only: it reviews the scheduled workflow, Sites runtime logs, overview counts, and source-health regressions. It must not duplicate the production crawl trigger.

Codex review candidates are exposed through the authenticated
`GET /api/pulse?resource=resumeReviewCandidates&limit=100` feed. It returns only
current, open internship/co-op matches that do not already have a Codex review;
the reviewer still decides U.S. region, 2027 cycle, and profile fit. Approved
records are submitted with `submitCodexReview`, which wakes the Gmail queue.
The scheduled alert action returns a non-2xx response for delivery/auth errors
so GitHub Actions cannot report a green run when email dispatch failed.

For a local parser audit against the currently failed/blocked production sources:

```bash
CRAWLER_AUDIT_LIVE_URL=https://job-pulse-realtime.autodev61.chatgpt.site \
CRAWLER_AUDIT_HEALTH=failed,blocked \
npm run crawler:audit
```

The legacy `worker/crawler.ts` entry remains useful for local scheduled-handler tests but is not the production scheduler.
