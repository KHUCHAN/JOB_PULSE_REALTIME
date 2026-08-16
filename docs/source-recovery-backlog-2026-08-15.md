# Source recovery backlog — 2026-08-15

This file is the restart point after the Alaska Air, Siemens EDA, and Yum Brands repair batch. Do not treat a generic HTTP 200 careers page as a working job feed; each item is complete only after the production crawler stores official job-detail URLs and the source becomes healthy.

## Repaired in the current unpublished batch

- Alaska Air Group (`audit-row-306`): Jobsyn API can return 403 to Worker egress. The official `https://careers.alaskaair.com/sitemaps/jobs_1.xml` contains 46 canonical job URLs. Use the Jobsyn API first and the sitemap as an addition-safe fallback.
- Siemens EDA (`p5-1054-siemens-eda`): Jobsyn API can fail from Worker egress. The official `https://jobs.sw.siemens.com/sitemaps/jobs_1.xml` contains 725 canonical job URLs. Keep only positively US or unknown/mixed roles.
- Yum Brands (`legacy-row-886`): the branded page is a Laravel/Inertia shell, while `https://jobs.yum.com/sitemap.xml` contains 150 canonical live job URLs. Parse the official sitemap directly and keep only positively US or unknown/mixed roles.

## Next exact recoveries

### 1. Nardello & Co. (`p4-0463-nardello-co`)

- Corporate careers page: `https://nardelloandco.com/careers/`
- Exact official ATS linked by that page: `https://nardelloandco.bamboohr.com/careers`
- Exact public feed: `https://nardelloandco.bamboohr.com/careers/list`
- Last direct check: HTTP 200, `meta.totalCount = 6`.
- Next action: add a catalog URL override to the BambooHR board, regenerate an immutable catalog migration, update the master workbook, then recrawl. The existing BambooHR adapter already validates `totalCount` and stable job IDs.

### 2. Best Buy (`p5-0824-best-buy`)

- Official listing: `https://jobs.bestbuy.com/bby?id=all_jobs&spa=1`
- Surface: ServiceNow Service Portal, page id `all_jobs`, instance `bestbuy`, portal id `c5f6902e1b91b850b4c011f18c4bcbf5`.
- Last direct check: HTTP 200 and roughly 1.08 MB of shell HTML, but the generic HTML crawler cannot see the dynamically loaded catalog.
- Next action: use the connected browser once to capture the official ServiceNow widget request and response schema, then reproduce that request with bounded `fetch` pagination. Validate advertised total, unique requisition identities, canonical Best Buy URLs, and repeated-page safety before permitting stale closure.

### 3. Sarcos Robotics / Palladyne AI (`p5-1052-sarcos-robotics`)

- Corporate careers page: `https://www.palladyneai.com/careers/`
- Last direct server request: Cloudflare 403.
- Production already retained 13 official jobs, so do not replace or close them from a blocked empty response.
- Next action: group the 13 stored canonical URLs by origin and requisition pattern, identify the first-party ATS/feed from those URLs, validate it against the browser-visible careers page, and add an ID-pinned request adapter. Keep any browser/reader fallback addition-only.

## Completion gates for every remaining source

1. Official employer/ATS listing and job-detail URLs are confirmed.
2. Pagination is bounded and stable identities are validated.
3. Empty, malformed, repeated, blocked, or truncated responses cannot close jobs.
4. US-only scoping is applied to large global catalogs while unknown/mixed locations remain visible.
5. Focused tests, typecheck, lint, full tests, and production build pass.
6. URL changes are written to the catalog, immutable migration, and master Excel workbook.
7. The exact production source is recrawled and verified healthy with nonzero current jobs when the official board is nonempty.
8. Recount failed, blocked, inactive, and healthy-zero sources before selecting the next batch.
