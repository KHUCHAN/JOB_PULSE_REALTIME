# Personal Job Monitor — Product and Frontend Design

**Date:** 2026-08-08  
**Status:** Approved for implementation
**Delivery platform:** OpenAI Sites  

## 1. Product goal

Build a private, personal operations console that turns the verified US company dataset into a searchable job-monitoring system. The user can enter keywords, review matching jobs in one place, inspect source health, manage email-alert rules, and work through a Talent Community registration queue.

The first implementation slice is the complete frontend shell using typed fixture data. Persistent D1 storage, live crawling, internal webhook processing, and email delivery follow behind the same frontend data contracts so the UI does not need to be redesigned.

## 2. Current source data

The current verified workbook contains:

- 1,567 companies;
- 1,548 active official Posting URLs;
- 439 exact Talent Community or Job Alert URLs;
- zero rows still carrying an unresolved audit classification.

The workbook remains the seed dataset for the initial import. The production database becomes the source of truth after the persistence phase.

## 3. Scope

### Included

- Private personal dashboard with no public registration flow.
- Keyword and exclusion-term management.
- Searchable and filterable consolidated job list.
- Company/source monitoring status.
- Alert status and delivery history views.
- Talent registration queue and assisted-workflow status.
- Crawl and notification activity history.
- Responsive desktop-first layout with a usable mobile view.

### Excluded from the frontend-first slice

- Live crawling or scheduled runs.
- Live email sending.
- Live D1 reads and writes.
- Automated application or Talent Community submission.
- CAPTCHA handling or bypassing.
- Multi-user accounts, billing, social features, and a public job board.

## 4. Recommended product shape

Use a multi-route private operations console rather than a single dense dashboard or a public consumer job board. This supports the operational parts of the product—source health, crawl failures, alerts, and Talent registration—without mixing them into the job-search experience.

### Primary navigation

1. **Overview** — system summary and high-priority actions.
2. **Jobs** — consolidated job search and match review.
3. **Sources** — company and crawler-source health.
4. **Alerts** — keywords, exclusions, email configuration, and delivery state.
5. **Talent Harness** — verified Talent URLs and assisted registration queue.
6. **Activity** — crawl, change-detection, webhook, and notification history.

## 5. Frontend experience

### Global shell

- Compact left navigation on desktop and a collapsible navigation sheet on mobile.
- Persistent product title and environment badge indicating that the app is private.
- Global keyword input and `Crawl now` action in the top bar.
- In the frontend-only slice, `Crawl now` creates an explicitly labeled fixture activity event and never makes a network request.
- Clear system-health indicator using text and color, never color alone.
- Dense but readable data presentation designed for repeated daily use.

### Overview

- Summary cards: new matching jobs, active sources, source errors, unsent alerts, and open Talent tasks.
- Latest matching jobs list with match reasons.
- Source-health strip showing healthy, changed, blocked, and inactive counts.
- Registration queue preview with the next recommended Talent actions.
- Recent activity timeline.

### Jobs

- Search field plus filters for keyword rule, company, location, work arrangement, source, first-seen time, and status.
- Table on desktop and stacked cards on narrow screens.
- Default sort: newly discovered first, then match score, then company.
- Job detail opens in a right-side drawer and shows:
  - title, company, location, and source;
  - matched and excluded terms;
  - first-seen and last-confirmed times;
  - canonical official posting URL;
  - save, hide, mark-applied, and open-official-posting actions.

### Sources

- One row per company or ATS board.
- Fields: company, posting URL, ATS adapter, HTTP status, extraction status, current job count, last checked, last changed, and next run.
- Quick filters for healthy, changed, parser failed, blocked, redirected, and inactive.
- Source detail exposes recent checks and normalized changes without showing raw HTML by default.

### Alerts

- Keyword rules with include terms, exclude terms, optional location filters, enabled state, and notification mode.
- Personal email destination shown as configuration, not editable account identity.
- Delivery summary with last sent, matched jobs, success/failure, and duplicate suppression.
- Frontend fixtures use a six-hour monitoring default and support a daily-digest display option; the live scheduling decision is applied in the backend phase.

### Talent Harness

- Queue built from exact verified Talent Community and Job Alert URLs.
- Fields: company, ATS, Talent URL, resume-upload capability, Job Alert capability, workflow state, blocker, and last attempt.
- Actions: open official page, start assisted flow, mark completed, mark blocked, and add a note.
- Assisted flow stops for CAPTCHA, SMS, custom employer questions, or final submission. The product never claims to bypass or complete those gates automatically.

### Activity

- Unified chronological event feed for crawl runs, source changes, job lifecycle events, keyword matches, email deliveries, and Talent workflow updates.
- Severity and event-type filters.
- Human-readable event summaries with technical identifiers available in expandable details.

## 6. Visual direction

- Professional operations-console aesthetic rather than a generic admin template.
- Deep navy navigation, warm off-white canvas, and high-contrast white data surfaces.
- Green for healthy/ready, amber for review, red for failures, blue for informational changes, and gray for inactive states.
- Tabular numerals for counts and timestamps.
- Moderate information density, 44-pixel minimum interactive targets, visible keyboard focus, and persistent table headers.
- No decorative hero imagery; the product value is expressed through live operational data and clear hierarchy.

## 7. Data architecture

GPT is not the database. Sites provides platform-backed persistence through a logical Cloudflare D1 binding. D1 is a SQLite-compatible structured database that Sites provisions and connects during deployment. The frontend-first slice uses a fixture repository; the persistence slice replaces it with a D1 repository implementing the same interface.

### Core D1 tables

| Table | Purpose |
|---|---|
| `sources` | Company identity, official URLs, adapter, validators, health, and scheduling state. |
| `jobs` | Normalized job records and lifecycle timestamps. |
| `keywords` | Include/exclude terms, location constraints, and enabled state. |
| `job_matches` | Keyword-to-job matches, reasons, score, and notification state. |
| `crawl_runs` | Run-level status, timing, counts, and errors. |
| `notifications` | Email attempts, deduplication key, provider state, and delivery result. |
| `talent_targets` | Verified Talent URLs, ATS capabilities, registration state, and blocker. |
| `registration_runs` | Assisted-harness attempts and outcomes. |

No `users` table is needed for the personal MVP. Owner email and external service credentials are deployment secrets rather than database rows.

R2 object storage is not required initially. It can be added later for raw HTML snapshots, screenshots, or uploaded resume files while D1 retains their searchable metadata.

## 8. Frontend data contracts

The frontend depends on a small repository boundary rather than reading fixtures or D1 directly from page components.

- `getOverview()`
- `listJobs(filters)`
- `getJob(jobId)`
- `listSources(filters)`
- `listKeywords()`
- `listTalentTargets(filters)`
- `listActivity(filters)`
- mutation contracts for keyword, job-state, source-run, and Talent-workflow actions

The fixture and D1 implementations return the same domain types. This keeps the frontend-first slice honest and prevents a later persistence rewrite.

## 9. Future ingestion and webhook flow

The frontend anticipates the following backend flow without implementing it in the first slice:

```text
Official ATS API
  or conditional HTTP request
  or browser fallback
        ↓
Normalize and deduplicate jobs
        ↓
Create internal job.created / job.updated / job.closed events
        ↓
Keyword matcher
        ↓
D1 job and match state
        ↓
Email delivery + Sites activity feed
```

External ATS webhooks are optional accelerators when authorized credentials exist. The internal webhook/event contract applies uniformly to every source regardless of how that source is collected.

## 10. Error and empty states

- Every route has loading, empty, stale-data, partial-failure, and retry states.
- A source failure does not hide previously confirmed jobs.
- Stale data is labeled with its last successful check time.
- Failed actions retain the user’s input and present a retry action.
- Email failure is distinct from match failure so successful matches are not rediscovered or duplicated.
- Unknown fixture actions display a clear non-destructive message rather than pretending a live backend exists.
- Every simulated mutation is labeled `Demo data` until the D1 repository is connected.

## 11. Verification strategy

### Frontend-first slice

- Deployment build passes.
- Navigation reaches all six routes.
- Keyword, filters, drawer, queue actions, and empty/error states operate against fixtures.
- Responsive behavior is validated through component and layout checks.
- Keyboard focus, accessible labels, and color-independent statuses are verified.
- No control claims to have crawled, emailed, persisted, or submitted live data.

### Later capability slices

- D1 migrations and query plans are inspected.
- Repository contract tests run against fixtures and D1.
- Source-adapter fixtures verify job normalization and deduplication.
- Internal webhook signatures, idempotency, retries, and dead-letter behavior are tested.
- Email deduplication and job-closure rules are covered by integration tests.
- Talent Harness tests confirm stopping behavior at restricted gates.

## 12. Delivery sequence

1. Frontend shell and realistic fixtures.
2. D1 schema, migrations, workbook seed import, and repository swap.
3. ATS/API/HTTP source adapters and change detection.
4. Internal webhook events, keyword matching, and email delivery.
5. Assisted Talent registration harness integration.
6. Operational hardening, monitoring, and optional R2 snapshots.

## 13. Frontend acceptance criteria

- The app presents all six routes in a cohesive private console.
- A keyword can be added in fixture mode and immediately filters representative jobs.
- Jobs show match reasons and open an official-posting detail drawer.
- Sources clearly communicate health and last-check state.
- Talent targets show actionable URLs and workflow blockers.
- Activity makes fixture events understandable without technical context.
- The interface is usable on desktop and mobile and does not imply that backend capabilities are already live.
