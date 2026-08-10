# AI & Data Science Job Topic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fast, indexed AI & Data Science topic filter, separate Company and Role presentation, and remove global filter-option aggregation from the blocking Jobs result request.

**Architecture:** A pure deterministic classifier assigns `ai-data` membership from collected job fields. Membership is persisted in an indexed `job_topics` table during crawls and through a bounded production backfill. Jobs results query the membership index, while filter options move to an independent API request so result rendering is no longer blocked by the catalog-wide facet aggregation.

**Tech Stack:** TypeScript 5.9, React 19, Vinext/Next-compatible App Router, Cloudflare Workers and D1 SQLite, Drizzle ORM, Vitest, Testing Library, Sites hosting.

## Global Constraints

- Keep the Site private with the existing owner-only access policy.
- Do not introduce an LLM, embeddings, or an external classification service.
- `topic=ai-data` must compose with all existing filters and only return open canonical jobs.
- Body-only incidental AI mentions do not qualify; short tokens use word boundaries.
- Jobs results must render within 3 seconds cold and 1 second warm on the production-size catalog.
- Global filter suggestions must never block the result table.
- Preserve the user-owned untracked `exports/` directory.

---

### Task 1: Deterministic AI/Data classifier

**Files:**
- Create: `lib/job-topic-classifier.ts`
- Create: `lib/job-topic-classifier.test.ts`

**Interfaces:**
- Produces: `classifyAiDataJob(input: AiDataJobInput): JobTopicClassification`
- Produces: `AiDataJobInput` containing `title`, text fields, structured organization fields, and `skills`.
- Produces: `JobTopicClassification = { topicKey: "ai-data"; matched: boolean; score: number; evidence: string[] }`.

- [ ] **Step 1: Write failing classifier tests**

```ts
expect(classifyAiDataJob({ title: "Senior Machine Learning Engineer" })).toMatchObject({ matched: true });
expect(classifyAiDataJob({ title: "Account Executive", description: "Use AI tools for notes." })).toMatchObject({ matched: false });
expect(classifyAiDataJob({ title: "Software Engineer", team: "Generative AI", skills: ["PyTorch"] })).toMatchObject({ matched: true });
expect(classifyAiDataJob({ title: "Paid Media Manager" })).toMatchObject({ matched: false });
expect(classifyAiDataJob({ title: "Data Engineer" })).toMatchObject({ matched: true });
```

- [ ] **Step 2: Run the classifier tests and verify RED**

Run: `npx vitest run lib/job-topic-classifier.test.ts`

Expected: FAIL because `job-topic-classifier` does not exist.

- [ ] **Step 3: Implement normalized, evidence-producing classification**

Use token-safe strong phrases for `artificial intelligence`, `machine learning`, `deep learning`, `generative ai`, `genai`, `large language model`, `llm`, `nlp`, `natural language processing`, `computer vision`, `reinforcement learning`, `recommendation systems`, `data science`, `data scientist`, `decision scientist`, `applied scientist`, `research scientist`, `data engineering`, `data engineer`, `analytics engineering`, `analytics engineer`, `data analyst`, `data analytics`, `business intelligence`, `ml engineer`, `mlops`, `model infrastructure`, `data platform`, `pytorch`, and `tensorflow`.

Assign structural/title matches 3 points, exact skills 2 points, and body supporting signals 1 point. Match at 3 points. Deduplicate evidence and use `(^|[^a-z0-9])ai([^a-z0-9]|$)`-style boundaries for short tokens.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npx vitest run lib/job-topic-classifier.test.ts`

Expected: PASS with title, structured-field, body-only, skill, and token-boundary cases.

- [ ] **Step 5: Commit the classifier**

```bash
git add lib/job-topic-classifier.ts lib/job-topic-classifier.test.ts
git commit -m "feat: classify AI and data jobs"
```

### Task 2: Indexed topic persistence during crawls

**Files:**
- Modify: `db/schema.ts`
- Create: `drizzle/0037_ai_data_job_topics.sql`
- Create: `drizzle/meta/0037_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Modify: `worker/crawl-store.ts`
- Modify: `worker/crawl-store.test.ts`

**Interfaces:**
- Consumes: `classifyAiDataJob()` from Task 1.
- Produces: `job_topics(job_id, topic_key, score, evidence, classified_at)`.
- Produces: nullable `jobs.topic_classified_at` for bounded backfill eligibility.

- [ ] **Step 1: Add failing schema and persistence tests**

Assert that the schema exposes `jobTopics`, the migration creates a primary key on `(job_id, topic_key)` plus `job_topics_topic_job_idx(topic_key, job_id)`, and `syncJobs()` writes membership for a matching job while deleting stale `ai-data` membership for a processed nonmatch.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run worker/crawl-store.test.ts lib/job-topic-classifier.test.ts`

Expected: FAIL because topic schema and crawl persistence do not exist.

- [ ] **Step 3: Add the immutable migration and Drizzle schema**

```sql
ALTER TABLE jobs ADD COLUMN topic_classified_at TEXT;
CREATE TABLE job_topics (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  topic_key TEXT NOT NULL,
  score INTEGER NOT NULL,
  evidence TEXT NOT NULL DEFAULT '[]',
  classified_at TEXT NOT NULL,
  PRIMARY KEY (job_id, topic_key)
);
CREATE INDEX job_topics_topic_job_idx ON job_topics(topic_key, job_id);
```

Generate the matching immutable snapshot chain without editing prior migrations.

- [ ] **Step 4: Persist topic membership in the existing bounded chunks**

For each normalized record, add `aiDataScore`, `aiDataEvidence`, and `topicClassifiedAt`. After the jobs upsert chunk, insert matching memberships by joining chunk `(sourceId, officialUrl)` values back to `jobs`; delete `ai-data` memberships for processed records whose score is zero. Keep every JSON payload at or below 1,500,000 bytes and preserve the existing large-catalog query-count test.

- [ ] **Step 5: Run persistence tests and query-budget tests**

Run: `npx vitest run worker/crawl-store.test.ts`

Expected: PASS, including 10,000-job payload/query-budget coverage.

- [ ] **Step 6: Commit schema and persistence**

```bash
git add db/schema.ts drizzle worker/crawl-store.ts worker/crawl-store.test.ts
git commit -m "feat: persist indexed job topics"
```

### Task 3: Bounded existing-job backfill

**Files:**
- Create: `lib/job-topic-backfill.ts`
- Create: `lib/job-topic-backfill.test.ts`
- Modify: `app/api/pulse/route.ts`
- Modify: `lib/crawl-batch-options.ts`
- Modify: `lib/crawl-batch-options.test.ts`

**Interfaces:**
- Consumes: `classifyAiDataJob()` and the Task 2 schema.
- Produces: `backfillJobTopics(db: D1Database, limit: number): Promise<{ processed: number; matched: number; remaining: number }>`.
- Produces: private POST action `{ action: "backfillJobTopics", limit: 250 }`, capped at 500 rows.

- [ ] **Step 1: Write a failing SQLite-backed backfill test**

Create matching, incidental, and already-classified open jobs. Assert that one bounded call classifies only null `topic_classified_at` rows, inserts only true memberships, marks nonmatches classified, and returns an exact remaining count.

- [ ] **Step 2: Run the backfill test and verify RED**

Run: `npx vitest run lib/job-topic-backfill.test.ts`

Expected: FAIL because `backfillJobTopics` does not exist.

- [ ] **Step 3: Implement the bounded idempotent backfill**

Select at most `limit` open jobs with null `topic_classified_at`, classify them in TypeScript, and use bounded D1 statements to upsert memberships and mark every processed job. A retry must produce no duplicate membership and must continue from remaining null rows.

- [ ] **Step 4: Expose the capped private action**

Clamp input with `Math.max(1, Math.min(500, requested ?? 250))`. Return processed, matched, and remaining counts; do not change crawl scheduling or Site access.

- [ ] **Step 5: Run backfill and route-helper tests**

Run: `npx vitest run lib/job-topic-backfill.test.ts lib/crawl-batch-options.test.ts`

Expected: PASS for limits, idempotency, evidence, and remaining count.

- [ ] **Step 6: Commit the backfill**

```bash
git add lib/job-topic-backfill.ts lib/job-topic-backfill.test.ts app/api/pulse/route.ts lib/crawl-batch-options.ts lib/crawl-batch-options.test.ts
git commit -m "feat: backfill job topic memberships"
```

### Task 4: Topic filter codec, validation, and indexed SQL

**Files:**
- Modify: `lib/domain.ts`
- Modify: `lib/job-filter-query.ts`
- Modify: `lib/job-filter-query.test.ts`
- Modify: `lib/job-filter-validation.ts`
- Modify: `lib/job-filter-validation.test.ts`
- Modify: `lib/job-search-sql.ts`
- Modify: `lib/job-search-sql.test.ts`
- Modify: `lib/fixture-repository.ts`
- Modify: `lib/fixture-repository.test.ts`

**Interfaces:**
- Produces: `JobTopicKey = "ai-data"` and `JobFilters.topics?: JobTopicKey[]`.
- Produces: repeated URL parameter `topic=ai-data`.
- Consumes: `job_topics` from Task 2.

- [ ] **Step 1: Write failing codec and validation tests**

```ts
expect(parseJobFilterParams(new URLSearchParams("topic=ai-data")).topics).toEqual(["ai-data"]);
expect(serializeJobFilters({ ...defaultJobFilters, topics: ["ai-data"] }).toString()).toContain("topic=ai-data");
expect(() => validateExplicitJobFilterValues(new URLSearchParams("topic=unknown"))).toThrow("Invalid topic");
```

- [ ] **Step 2: Write a failing indexed SQL test**

Populate a production-shaped SQLite database with matching and nonmatching jobs. Assert only membership rows return, filters compose with `year=2027` and `program=internship`, and `EXPLAIN QUERY PLAN` contains `job_topics_topic_job_idx`.

- [ ] **Step 3: Run tests and verify RED**

Run: `npx vitest run lib/job-filter-query.test.ts lib/job-filter-validation.test.ts lib/job-search-sql.test.ts lib/fixture-repository.test.ts`

Expected: FAIL because topic filters are unknown.

- [ ] **Step 4: Implement the minimal topic filter path**

Add `topics: []` to defaults, parse and serialize repeated `topic`, reject any value other than `ai-data`, and add:

```sql
j.id IN (SELECT job_id FROM job_topics WHERE topic_key = ?)
```

Use the same deterministic classifier for fixture records so demo mode matches live semantics.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 4 command again. Expected: PASS, including the query-plan assertion.

- [ ] **Step 6: Commit topic search**

```bash
git add lib/domain.ts lib/job-filter-query.ts lib/job-filter-query.test.ts lib/job-filter-validation.ts lib/job-filter-validation.test.ts lib/job-search-sql.ts lib/job-search-sql.test.ts lib/fixture-repository.ts lib/fixture-repository.test.ts
git commit -m "feat: filter jobs by indexed topic"
```

### Task 5: Decouple filter options from Jobs results

**Files:**
- Modify: `lib/domain.ts`
- Modify: `lib/repository.ts`
- Modify: `lib/api-repository.ts`
- Modify: `lib/api-repository.test.ts`
- Modify: `lib/fixture-repository.ts`
- Modify: `app/api/pulse/route.ts`
- Modify: `features/jobs/jobs-screen.tsx`
- Modify: `features/jobs/jobs-screen.test.tsx`

**Interfaces:**
- Produces: `JobPulseRepository.getJobFilterOptions(): Promise<JobFilterOptions>`.
- Changes: `JobSearchResult` contains `items`, `total`, `page`, and `pageSize` only.
- Produces: GET `/api/pulse?resource=jobFilterOptions`.

- [ ] **Step 1: Write failing repository and screen tests**

Assert `/api/pulse?resource=jobs` maps a result without `availableFilters`, `getJobFilterOptions()` calls the separate resource, and the Jobs table renders immediately from a resolved result while options remain pending.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run lib/api-repository.test.ts features/jobs/jobs-screen.test.tsx`

Expected: FAIL because options are still embedded in search results.

- [ ] **Step 3: Split the API operations**

Remove `availableFilterOptions()` from `jobsFor()`. Add `resource=jobFilterOptions` using the existing 10-minute in-isolate cache. Keep list/detail projections unchanged.

- [ ] **Step 4: Load options without blocking results**

Start the independent options query only after the first Jobs result resolves or when `More filters` opens, whichever occurs first. Pass `undefined` options while pending; text inputs and selects remain usable.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 5 command again. Expected: PASS with independent loading and no filter payload in result requests.

- [ ] **Step 6: Commit the latency split**

```bash
git add lib/domain.ts lib/repository.ts lib/api-repository.ts lib/api-repository.test.ts lib/fixture-repository.ts app/api/pulse/route.ts features/jobs/jobs-screen.tsx features/jobs/jobs-screen.test.tsx
git commit -m "perf: unblock job results from filter facets"
```

### Task 6: AI/Data preset and scannable Company/Role UI

**Files:**
- Modify: `features/jobs/job-filter-panel.tsx`
- Modify: `features/jobs/active-filter-chips.tsx`
- Modify: `features/jobs/jobs-screen.tsx`
- Modify: `features/jobs/jobs-screen.test.tsx`
- Modify: `components/ui/company-logo.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `JobFilters.topics` and `CompanyLogo`.
- Produces: accessible `AI & Data Science` toggle and removable `Topic: AI & Data Science` chip.

- [ ] **Step 1: Write failing component tests**

Assert that activating the preset updates the request and URL to `topic=ai-data`, the chip removes it, the desktop table exposes separate `Company` and `Role` headers, and company and role remain separately labeled in mobile markup.

- [ ] **Step 2: Run the component tests and verify RED**

Run: `npx vitest run features/jobs/jobs-screen.test.tsx`

Expected: FAIL because the preset and separate columns do not exist.

- [ ] **Step 3: Implement the preset and filter chip**

Add a pressed-state button with `aria-pressed`, toggle `topics: ["ai-data"]`, include topics in `arrayFilterKeys`, and render `Topic: AI & Data Science` in `ActiveFilterChips`.

- [ ] **Step 4: Separate Company and Role rendering**

Desktop order starts with Company then Role. Company uses `<CompanyLogo company={job.company} />` and visible full name. Mobile uses the same logo component, a company label, and a distinct dominant title. Update column-specific CSS widths without truncating either value.

- [ ] **Step 5: Run component tests and verify GREEN**

Run the Task 6 command again. Expected: PASS for URL, preset state, chip removal, desktop headers, and mobile labels.

- [ ] **Step 6: Commit the UI**

```bash
git add features/jobs/job-filter-panel.tsx features/jobs/active-filter-chips.tsx features/jobs/jobs-screen.tsx features/jobs/jobs-screen.test.tsx components/ui/company-logo.tsx app/globals.css
git commit -m "feat: add AI data jobs view"
```

### Task 7: Full verification, backfill, data audit, and private deployment

**Files:**
- Create: `scripts/audit-ai-data-topic.ts`
- Create: `scripts/audit-ai-data-topic.test.ts`
- Modify: `package.json`
- Modify: `docs/database.md`

**Interfaces:**
- Produces: `npm run jobs:topic:audit` with counts and a deterministic sample; it performs no writes.

- [ ] **Step 1: Add a failing audit-format test**

Assert the audit groups evidence, reports matched/open totals, emits at most 100 sampled records with official URLs, and fails when known AI/Data fixture titles are missing.

- [ ] **Step 2: Implement and test the read-only audit**

Run: `npx vitest run scripts/audit-ai-data-topic.test.ts`

Expected after implementation: PASS.

- [ ] **Step 3: Run full local verification**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Benchmark production-size SQLite**

Measure cold and repeated `topic=ai-data` page/count queries and confirm `EXPLAIN QUERY PLAN` uses `job_topics_topic_job_idx`. Compare against the recorded 33.2-second cold 2027 Internship/Co-op response.

- [ ] **Step 5: Deploy privately and run the bounded backfill**

Push the exact validated commit to GitHub and the existing Sites source repository. Save and deploy one new private version only after confirming owner-only access. Call `backfillJobTopics` in batches no larger than 500 until `remaining` is zero.

- [ ] **Step 6: Audit production data**

Verify topic count, sample at least 100 matches across companies, inspect evidence for false positives, and confirm all known AI/Data title fixtures appear. Target at least 90% precision and zero known-title misses.

- [ ] **Step 7: Browser QA**

Using the Browser plugin, verify `/jobs?topic=ai-data` at desktop and mobile widths: page identity, meaningful DOM, no framework overlay, no relevant console warnings/errors, separate Company and Role display, preset interaction, URL state, removable chip, pagination, and official-link access. Capture screenshots as evidence.

- [ ] **Step 8: Verify live latency and access**

Measure the first and repeated live topic requests. Confirm cold results are at most 3 seconds, warm results at most 1 second, filter options do not block the table, and Site access remains owner-only with zero external visitors or groups.

- [ ] **Step 9: Commit audit documentation**

```bash
git add scripts/audit-ai-data-topic.ts scripts/audit-ai-data-topic.test.ts package.json docs/database.md
git commit -m "test: audit AI data job coverage"
```
