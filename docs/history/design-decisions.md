# Early design decisions (Aug 8-10, 2026)

Condensed from docs/superpowers/specs and plans (deleted; recoverable from the doc archive tarball). Implementation lives in code and tests.

- Personal job monitor: private console over the verified US company dataset (keywords, job review, source health, alert rules, provider-only Talent Community links). UI shipped first on typed fixtures, then D1, crawling, webhooks and email behind the same data contracts. No automated applying or form submission.
- Job filtering: expose structured job fields as composable filters; `Recruiting year = 2027` plus `Program type = Internship or Co-op` reproduces the 2027 export without full-text search.
- AI & Data topic: deterministic `ai-data` membership in `job_topics` (not on the job body); first page must not wait on the global filter-option aggregation (cold filtered request took ~33s).
- 2027 Tech Internship and region: managed `area:ai-ml`, `area:data-analytics`, `area:software-engineering`; pure finance/actuarial/consulting/product roles do not count as Data/Analytics. `location_region` is us / non_us / mixed / unknown.
- Resume-match Gmail alert: deterministic, cheap enough after every crawl, duplicate-safe under concurrent crawls. Eligible = open, `location_region='us'`, program internship or coop, not high-school-only or PhD-only, no explicit citizenship/clearance requirement. A 2027 cycle and master's eligibility are positive signals only; yearless US internships stay eligible; generic "no sponsorship" is not an exclusion. Current authoritative rules are in `review-runtime/POLICY.md`.
