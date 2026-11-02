# Job Pulse crawler

Runs inside the Sites API with HTTP `fetch` plus JS parsers. No login, CAPTCHA solving, resume upload or application submit. Scheduler: `.github/workflows/production-crawl.yml` (see [scheduling](scheduling.md)).

- Auth: short-lived GitHub OIDC token (signature, audience, repo, branch, workflow path, event verified by the Sites API); refreshed during long drains. No stored shared secret.
- Drain: `scheduledCrawlBatch`, at most 2 concurrent leases, 20-minute window. Each request leases a due source, writes `crawl_runs`, upserts open jobs, sets next check: success +2h, failed +6h, access-blocked +24h. The next run continues the queue. Email planning/delivery runs once after the drain.
- Adapters: native JSON/API (Greenhouse, Lever, Workday, Ashby, SmartRecruiters, Workable, BambooHR, Oracle, SuccessFactors, Phenom, Eightfold, ADP, UKG, Avature, Paylocity, others); official landing pages are inspected once for public ATS links (also inside JS state); schema.org JobPosting, server-rendered listings, sitemaps and bounded reader fallbacks otherwise. See [reader usage](reader-inventory.md).
- Cross-domain follow-up only to allow-listed public ATS hosts linked by the official page. Login, talent-community, alert, application and individual job-detail routes are rejected as source roots.
- Closure rule: only an authoritative, fully enumerated API or sitemap cycle may close unseen jobs. Partial landing pages, fallbacks and browser recovery add/update only.

## Review feed
- `GET /api/pulse?resource=resumeReviewCandidates&limit=100` (authenticated): current open internships after each source's baseline with no Codex review or durable identity delivery. The reviewer decides US region, cycle and fit (rules: `review-runtime/POLICY.md`).
- Approved records go through bounded `submitCodexReview` calls with `dispatch=false`; one `dispatchCodexReviewBatch` call then sends a single digest. Requisition, external ATS and canonical official-URL identities stop re-mailing of reopened or URL-variant postings. The alert action returns non-2xx on delivery/auth errors.
- The Codex two-hour automation reviews and sends; it must not duplicate the crawl trigger.

## Commands
- Manual run: start the workflow from GitHub Actions (summary shows counts, drain status, health distribution).
- Parser audit: `CRAWLER_AUDIT_LIVE_URL=<site> CRAWLER_AUDIT_HEALTH=failed,blocked npm run crawler:audit`
- Single-source browser retry: `BROWSER_FALLBACK_SOURCE_ID=<id> BROWSER_FALLBACK_ALL=1 npm run crawler:fallback:browser`
- `worker/crawler.ts` is only for local scheduled-handler tests.
