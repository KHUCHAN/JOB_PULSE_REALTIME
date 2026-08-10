# Tech Internship Region Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable AI/ML, Data/Analytics/Quant, and direct Software Engineering area classification plus U.S./non-U.S./mixed/unknown region filtering and honest posting-date visibility to the Jobs page and the 2027 internship preset.

**Architecture:** Pure classifiers derive stable area topic keys and a single location-region value from normalized job data. The crawler stores those values during normal upserts, while a bounded API backfill classifies existing open jobs without a large transaction. Search uses the indexed `job_topics` table for OR-selected areas and an indexed `jobs.location_region` column for region, and the Jobs UI exposes a deep-linkable preset, visible region selector, and per-row badges.

**Tech Stack:** TypeScript 5.9, React 19, Vinext, Cloudflare Workers/D1 SQLite, Drizzle ORM, Vitest, Testing Library, Sites private deployment.

## Global Constraints

- Software scope is limited to direct Software Engineering/Developer roles; generic development programs, product development, IT, cloud, DevOps, security, hardware, and systems engineering are excluded without another direct area signal.
- Job areas are `ai-ml`, `data-analytics`, and `software-engineering`; multiple areas use OR semantics.
- Location regions are exactly `us`, `non_us`, `mixed`, and `unknown`; unknown data must never be silently classified as non-U.S.
- The preset is `2027 AND (internship OR coop) AND (AI/ML OR Data/Analytics/Quant OR Software Engineering)`.
- Internship/co-op membership comes from indexed `program:*` topics, not `employment_type`.
- Existing `topic=ai-data` deep links remain functional.
- Migrations are additive and immutable; do not modify migrations `0000` through `0044` or their snapshots.
- D1 JSON payloads remain at or below 1,500,000 bytes and Worker persistence remains within the existing bounded-query design.
- The Sites project remains private with its current access policy unchanged.
- Main result rows show `Posted` from `published_at`; when unavailable they show `First seen` from `first_seen_at` and never relabel crawler discovery time as the employer posting date.

---

## File map

- Create `lib/job-area-classifier.ts`: pure three-area classifier and evidence model.
- Create `lib/job-area-classifier.test.ts`: positive, negative, body, and multi-area classifier tests.
- Create `lib/job-region-classifier.ts`: pure structured/fallback region classifier.
- Create `lib/job-region-classifier.test.ts`: U.S., non-U.S., mixed, ambiguity, and unknown tests.
- Modify `db/schema.ts`: add `jobs.area_classified_at`, `jobs.location_region`, and the region search index.
- Create `drizzle/0045_tech_job_areas_regions.sql`: immutable additive D1 migration generated from the schema.
- Create `drizzle/meta/0045_snapshot.json` and modify `drizzle/meta/_journal.json`: generated migration metadata chained from `0044`.
- Modify `worker/crawl-store.ts`: classify/store areas and region during normal job upserts.
- Modify `scripts/browser-fallback-crawl.ts`: mirror normal upsert semantics for browser-fallback persistence.
- Modify `worker/crawl-store.test.ts` and `lib/browser-crawl-ingest.test.ts`: persistence regression coverage.
- Create `lib/job-area-region-backfill.ts`: bounded, retry-safe production backfill.
- Create `lib/job-area-region-backfill.test.ts`: backfill replacement, cursor, and retry tests.
- Modify `app/api/pulse/route.ts`: expose `backfillJobAreasAndRegions`.
- Modify `lib/job-filter-validation.ts`: bound the backfill request and validate new filter values.
- Modify `lib/domain.ts`: add area/region types, filters, and row fields.
- Modify `lib/job-filter-query.ts`: parse/serialize `area` and `region` deep links.
- Modify `lib/job-search-sql.ts`: indexed area OR filter, region filter, and area projection.
- Modify `lib/job-filter-options.ts`: expose cached region counts without scanning descriptions.
- Modify `lib/pulse-mappers.ts`: map region and area keys into `RichJobPosting`.
- Modify `lib/job-filter-query.test.ts`, `lib/job-search-sql.test.ts`, `lib/job-search-execution.test.ts`, `lib/job-filter-options.test.ts`, and `lib/pulse-mappers.test.ts`: API/search regression tests.
- Modify `features/jobs/job-filter-panel.tsx`: 2027 Tech preset, explicit area controls, and visible Region select.
- Modify `features/jobs/active-filter-chips.tsx`: removable area and region chips.
- Modify `features/jobs/jobs-screen.tsx`: desktop/mobile area and region badges.
- Modify `lib/format.ts`: deterministic absolute job-row date formatting.
- Modify `features/jobs/jobs-screen.test.tsx`: preset, URL state, visible filters, and badge rendering.
- Modify `app/globals.css`: responsive area/region badge and filter layout styling.
- Modify `docs/database.md`: operational migration/backfill/verification commands.

---

### Task 1: Pure job-area and location-region classifiers

**Files:**
- Create: `lib/job-area-classifier.ts`
- Create: `lib/job-area-classifier.test.ts`
- Create: `lib/job-region-classifier.ts`
- Create: `lib/job-region-classifier.test.ts`

**Interfaces:**
- Produces: `JobAreaKey`, `JobAreaClassification`, `classifyJobAreas(input)`.
- Produces: `JobRegion`, `JobRegionInput`, `classifyJobRegion(input)`.
- Consumed later by: crawler persistence, bounded backfill, domain/search mapping.

- [ ] **Step 1: Write failing area-classifier tests**

Add executable cases that assert exact key arrays and evidence prefixes:

```ts
expect(classifyJobAreas({ title: "Machine Learning Software Engineer Intern" })
  .map((item) => item.areaKey)).toEqual(["ai-ml", "software-engineering"]);
expect(classifyJobAreas({ title: "Summer 2027 Quantitative Research Internship" })
  .map((item) => item.areaKey)).toEqual(["data-analytics"]);
expect(classifyJobAreas({ title: "Spring 2027 Software Engineering Internship/Co-op" })
  .map((item) => item.areaKey)).toEqual(["software-engineering"]);
expect(classifyJobAreas({ title: "2027 Auditor Development Program (Intern Conversion)" })).toEqual([]);
expect(classifyJobAreas({ title: "Intern, Sustainable Development 2027" })).toEqual([]);
expect(classifyJobAreas({ title: "2027 Product Development Internship" })).toEqual([]);
expect(classifyJobAreas({
  title: "Intern, Information Technology 2027",
  description: "Assignments include Artificial Intelligence and Data & Analytics.",
}).map((item) => item.areaKey)).toEqual(["ai-ml", "data-analytics"]);
```

- [ ] **Step 2: Run the tests and confirm the missing-module failure**

Run: `npx vitest run lib/job-area-classifier.test.ts`

Expected: FAIL because `./job-area-classifier` does not exist.

- [ ] **Step 3: Implement the conservative area classifier**

Export these exact types and signature:

```ts
export type JobAreaKey = "ai-ml" | "data-analytics" | "software-engineering";
export type JobAreaInput = {
  title: string;
  summary?: string | null;
  description?: string | null;
  responsibilities?: string | null;
  qualifications?: string | null;
  skills?: string[] | null;
  department?: string | null;
  team?: string | null;
  businessUnit?: string | null;
  jobFamily?: string | null;
  jobFunction?: string | null;
};
export type JobAreaClassification = {
  areaKey: JobAreaKey;
  score: number;
  evidence: string[];
};
export function classifyJobAreas(input: JobAreaInput): JobAreaClassification[];
```

Use separate signal sets per area. Give title/department/team/family/function and explicit skills structural weight. Require conservative multi-signal body evidence as the current AI/Data classifier does. For Software Engineering, accept only direct phrases (`software engineer`, `software developer`, `application developer`, frontend/backend/full-stack/mobile/firmware developer or engineer, or `software development`) and explicitly reject bare `development`.

- [ ] **Step 4: Write failing region-classifier tests**

Cover structured values before raw fallback:

```ts
expect(classifyJobRegion({ locationCountry: "United States", location: "Remote" })).toBe("us");
expect(classifyJobRegion({ locationCountry: "France", location: "Paris" })).toBe("non_us");
expect(classifyJobRegion({ location: "Chicago, IL" })).toBe("us");
expect(classifyJobRegion({ location: "Singapore, Marina Bay" })).toBe("non_us");
expect(classifyJobRegion({ location: "Remote" })).toBe("unknown");
expect(classifyJobRegion({ location: "Flexible - Any Site" })).toBe("unknown");
expect(classifyJobRegion({
  locationCountry: "United States",
  secondaryLocations: ["Toronto, Ontario, Canada"],
})).toBe("mixed");
```

- [ ] **Step 5: Run the region test and confirm the missing-module failure**

Run: `npx vitest run lib/job-region-classifier.test.ts`

Expected: FAIL because `./job-region-classifier` does not exist.

- [ ] **Step 6: Implement deterministic region classification**

Export:

```ts
export type JobRegion = "us" | "non_us" | "mixed" | "unknown";
export type JobRegionInput = {
  location?: string | null;
  locationCity?: string | null;
  locationState?: string | null;
  locationCountry?: string | null;
  secondaryLocations?: string[] | null;
};
export function classifyJobRegion(input: JobRegionInput): JobRegion;
```

Normalize Unicode and whitespace. Resolve structured country and secondary locations first, then raw text. Use the 50 U.S. states plus D.C., full country aliases, and contextual `City, ST` forms. Return `mixed` when both sides are known and `unknown` when neither side is trustworthy.

- [ ] **Step 7: Verify the classifier task**

Run: `npx vitest run lib/job-area-classifier.test.ts lib/job-region-classifier.test.ts`

Expected: all classifier tests PASS.

- [ ] **Step 8: Commit the classifier task**

```bash
git add lib/job-area-classifier.ts lib/job-area-classifier.test.ts lib/job-region-classifier.ts lib/job-region-classifier.test.ts
git commit -m "feat: classify job areas and location regions"
```

---

### Task 2: Add indexed region and area-backfill state to D1

**Files:**
- Modify: `db/schema.ts:40-125`
- Create: `drizzle/0045_tech_job_areas_regions.sql`
- Create: `drizzle/meta/0045_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Modify: `lib/seed-migration.test.ts`

**Interfaces:**
- Consumes: `JobRegion` values from Task 1.
- Produces: nullable `jobs.location_region`, nullable `jobs.area_classified_at`, and `jobs_status_location_region_seen_idx`.

- [ ] **Step 1: Write a failing migration regression test**

Assert that the next immutable migration contains:

```ts
expect(sql).toContain('ALTER TABLE `jobs` ADD `location_region` text');
expect(sql).toContain('ALTER TABLE `jobs` ADD `area_classified_at` text');
expect(sql).toContain('CREATE INDEX `jobs_status_location_region_seen_idx`');
```

Also assert `_journal.json` ends at index `45` and `0045_snapshot.json` has `prevId` equal to the `0044_snapshot.json` id.

- [ ] **Step 2: Run the migration test and confirm failure**

Run: `npx vitest run lib/seed-migration.test.ts`

Expected: FAIL because migration `0045` and the new schema fields do not exist.

- [ ] **Step 3: Extend the Drizzle schema**

Add:

```ts
locationRegion: text("location_region", { enum: ["us", "non_us", "mixed", "unknown"] }),
areaClassifiedAt: text("area_classified_at"),
```

Add the index:

```ts
index("jobs_status_location_region_seen_idx")
  .on(table.status, table.locationRegion, table.firstSeenAt),
```

- [ ] **Step 4: Generate and inspect the immutable migration**

Run: `npm run db:generate -- --name tech_job_areas_regions`

Expected: creates migration `0045_tech_job_areas_regions.sql`, `0045_snapshot.json`, and journal entry 45 without changing earlier snapshots.

Inspect with:

```bash
git diff -- drizzle/0045_tech_job_areas_regions.sql drizzle/meta/0045_snapshot.json drizzle/meta/_journal.json db/schema.ts
```

- [ ] **Step 5: Verify migration consistency**

Run: `npx vitest run lib/seed-migration.test.ts && npm run typecheck`

Expected: migration test and typecheck PASS.

- [ ] **Step 6: Commit the schema task**

```bash
git add db/schema.ts drizzle/0045_tech_job_areas_regions.sql drizzle/meta/0045_snapshot.json drizzle/meta/_journal.json lib/seed-migration.test.ts
git commit -m "feat: index job areas and regions"
```

---

### Task 3: Classify new and refreshed crawler jobs

**Files:**
- Modify: `worker/crawl-store.ts:210-470`
- Modify: `scripts/browser-fallback-crawl.ts:170-225`
- Modify: `worker/crawl-store.test.ts`
- Modify: `lib/browser-crawl-ingest.test.ts`

**Interfaces:**
- Consumes: `classifyJobAreas`, `classifyJobRegion`, and Task 2 columns.
- Produces: `locationRegion`, `areaClassifiedAt`, and `areaMemberships` in each persistence record.

- [ ] **Step 1: Write failing normal-persistence tests**

Create a crawl fixture containing:

```ts
{
  title: "Spring 2027 Software Engineering Internship/Co-op",
  location: "Hawthorne, CA",
  locationCountry: "United States",
  officialUrl: "https://example.com/jobs/swe-2027",
}
```

Assert the job upsert binds `locationRegion: "us"`, sets `areaClassifiedAt`, and inserts `area:software-engineering`. Add a second refresh with `Leadership Development Program Intern` and assert managed `area:*` topics are removed while year/program topics remain.

- [ ] **Step 2: Run focused persistence tests and confirm failure**

Run: `npx vitest run worker/crawl-store.test.ts`

Expected: FAIL because area and region records are not persisted.

- [ ] **Step 3: Add classification to the bounded record path**

In `recordFor`, classify from the final normalized job fields:

```ts
const areaMemberships = classifyJobAreas(job).map((area) => ({
  topicKey: `area:${area.areaKey}`,
  score: area.score,
  evidence: area.evidence,
}));
const locationRegion = classifyJobRegion(job);
```

Write `location_region` and `area_classified_at` in the existing JSON upsert. On conflict, recompute from the merged location values instead of replacing a known region with a sparse `unknown`; use the stored structured values when a refresh omits them.

- [ ] **Step 4: Replace managed area topics safely**

For each already-bounded records chunk:

1. delete only `topic_key LIKE 'area:%'` for its resolved job ids;
2. insert all derived memberships in one JSON statement with `ON CONFLICT` update;
3. preserve `ai-data`, `program:*`, `year:*`, and unrelated topic keys.

Keep every JSON chunk at `1_500_000` bytes. Extend the realistic 10k-job query-budget test so the new statements keep persistence below the Worker invocation ceiling used by the existing suite.

- [ ] **Step 5: Mirror semantics in browser fallback SQL**

Extend the browser fallback upsert with both new columns. Use the same pure classifiers before building SQL. Ensure sparse refreshes preserve prior structured location data before deriving the new region. Add a fixture assertion covering `US` and `area:software-engineering`.

- [ ] **Step 6: Run crawler persistence tests**

Run: `npx vitest run worker/crawl-store.test.ts lib/browser-crawl-ingest.test.ts`

Expected: all persistence, sparse-refresh, and query-budget tests PASS.

- [ ] **Step 7: Commit the persistence task**

```bash
git add worker/crawl-store.ts scripts/browser-fallback-crawl.ts worker/crawl-store.test.ts lib/browser-crawl-ingest.test.ts
git commit -m "feat: persist job area and region classifications"
```

---

### Task 4: Backfill existing open jobs in bounded batches

**Files:**
- Create: `lib/job-area-region-backfill.ts`
- Create: `lib/job-area-region-backfill.test.ts`
- Modify: `app/api/pulse/route.ts:20-370`
- Modify: `lib/job-filter-validation.ts`
- Modify: `docs/database.md`

**Interfaces:**
- Consumes: Task 1 classifiers and Task 2 columns.
- Produces: `backfillJobAreasAndRegions(db, requestedLimit)` and POST action `backfillJobAreasAndRegions`.

- [ ] **Step 1: Write failing bounded-backfill tests**

Use a D1 mock to assert:

```ts
expect(result).toEqual({ processed: 3, areaMatched: 2, regionResolved: 2, remaining: 0 });
```

Cover these invariants:

- selects only open jobs with `area_classified_at IS NULL OR location_region IS NULL`;
- classifies a maximum of 500 jobs;
- deletes and replaces only managed `area:*` keys;
- writes `unknown` explicitly when region cannot be resolved;
- rerunning a completed batch performs no duplicate work;
- a failed insert leaves rows eligible for retry because `area_classified_at` is updated last.

- [ ] **Step 2: Run the new test and confirm failure**

Run: `npx vitest run lib/job-area-region-backfill.test.ts`

Expected: FAIL because the backfill module does not exist.

- [ ] **Step 3: Implement the bounded backfill**

Export:

```ts
export type JobAreaRegionBackfillResult = {
  processed: number;
  areaMatched: number;
  regionResolved: number;
  remaining: number;
};
export async function backfillJobAreasAndRegions(
  db: D1Database,
  requestedLimit: number,
): Promise<JobAreaRegionBackfillResult>;
```

Select structural fields first. Fetch descriptions only for records whose structural classification is empty and whose FTS/body candidate terms can change an area decision. Chunk managed-topic deletes, inserts, and job updates in groups of at most 100 and keep classification timestamps last.

- [ ] **Step 4: Add the POST action and request bound**

Add route behavior:

```ts
if (body.action === "backfillJobAreasAndRegions") {
  const requested = typeof body.limit === "number" ? body.limit : undefined;
  return json(await backfillJobAreasAndRegions(db(), jobAreaRegionBackfillLimit(requested)));
}
```

Implement `jobAreaRegionBackfillLimit` as an integer clamp from 1 through 500 with default 500 and test invalid, fractional, negative, and oversized values.

- [ ] **Step 5: Document operational commands**

Document the authenticated production loop contract: POST batches of 500 until `remaining` is zero, then force `refreshJobFilterOptions`, without changing Sites access or generating a new SIWC token.

- [ ] **Step 6: Verify the backfill task**

Run: `npx vitest run lib/job-area-region-backfill.test.ts lib/job-filter-validation.test.ts && npm run typecheck`

Expected: all focused tests and typecheck PASS.

- [ ] **Step 7: Commit the backfill task**

```bash
git add lib/job-area-region-backfill.ts lib/job-area-region-backfill.test.ts app/api/pulse/route.ts lib/job-filter-validation.ts lib/job-filter-validation.test.ts docs/database.md
git commit -m "feat: backfill job areas and regions"
```

---

### Task 5: Add indexed API, URL, and search filters

**Files:**
- Modify: `lib/domain.ts:1-90`
- Modify: `lib/job-filter-query.ts`
- Modify: `lib/job-search-sql.ts:40-180`
- Modify: `lib/job-filter-options.ts`
- Modify: `lib/pulse-mappers.ts:1-180`
- Modify: `lib/job-filter-query.test.ts`
- Modify: `lib/job-search-sql.test.ts`
- Modify: `lib/job-search-execution.test.ts`
- Modify: `lib/job-filter-options.test.ts`
- Modify: `lib/pulse-mappers.test.ts`

**Interfaces:**
- Consumes: Task 2 columns and Task 3 topic keys.
- Produces: `JobFilters.areas`, `JobFilters.regions`, `RichJobPosting.areaKeys`, and `RichJobPosting.locationRegion`.

- [ ] **Step 1: Write failing URL codec tests**

Assert exact round-trip behavior:

```ts
const filters = parseJobFilterParams(new URLSearchParams(
  "year=2027&program=internship&program=coop&area=ai-ml&area=data-analytics&area=software-engineering&region=us",
));
expect(filters.areas).toEqual(["ai-ml", "data-analytics", "software-engineering"]);
expect(filters.regions).toEqual(["us"]);
expect(serializeJobFilters(filters).getAll("area")).toEqual([
  "ai-ml", "data-analytics", "software-engineering",
]);
```

Also assert unknown area/region values are discarded and `topic=ai-data` still round-trips.

- [ ] **Step 2: Write failing search-plan tests**

Assert the plan:

- filters areas through indexed `job_topics_topic_job_idx` with OR semantics;
- filters `j.location_region` directly without `lower()` or `CASE`;
- combines year, program, areas, and region with AND;
- deduplicates canonical official URLs before filters;
- projects area keys and location region without selecting descriptions/raw payloads;
- uses the region index under a local `EXPLAIN QUERY PLAN` fixture.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `npx vitest run lib/job-filter-query.test.ts lib/job-search-sql.test.ts lib/job-search-execution.test.ts`

Expected: FAIL because the new filter fields, SQL, and projections do not exist.

- [ ] **Step 4: Extend domain and URL types**

Add:

```ts
export type JobAreaKey = "ai-ml" | "data-analytics" | "software-engineering";
export type JobRegion = "us" | "non_us" | "mixed" | "unknown";
```

Add optional `areas?: JobAreaKey[]` and `regions?: JobRegion[]` to `JobFilters`, and required `areaKeys: JobAreaKey[]` plus `locationRegion: JobRegion` to rich result rows. Parse repeated `area` and `region` parameters through allowlists and include them in active-filter counting.

- [ ] **Step 5: Implement indexed search semantics**

Add an `EXISTS`/indexed-subquery clause equivalent to:

```sql
j.id IN (
  SELECT selected_area.job_id
  FROM job_topics selected_area INDEXED BY job_topics_topic_job_idx
  WHERE selected_area.topic_key IN (?, ?, ?)
)
```

Bind `area:${key}` values. Add direct case-stable region equality predicates. Keep legacy `selected_topic.topic_key = 'ai-data'` behavior. Add a correlated bounded JSON aggregation for the three `area:*` memberships to list and detail projections.

- [ ] **Step 6: Map API rows and filter options**

Parse the projected JSON area array with an allowlist and default `location_region` to `unknown`. Add region counts to the filter-options cache from canonical deduped rows so UI labels can show available counts without scanning job descriptions.

- [ ] **Step 7: Run all API/search tests**

Run: `npx vitest run lib/job-filter-query.test.ts lib/job-search-sql.test.ts lib/job-search-execution.test.ts lib/job-filter-options.test.ts lib/pulse-mappers.test.ts`

Expected: all focused tests PASS, including the local index-plan assertion.

- [ ] **Step 8: Commit the search task**

```bash
git add lib/domain.ts lib/job-filter-query.ts lib/job-search-sql.ts lib/job-filter-options.ts lib/pulse-mappers.ts lib/job-filter-query.test.ts lib/job-search-sql.test.ts lib/job-search-execution.test.ts lib/job-filter-options.test.ts lib/pulse-mappers.test.ts
git commit -m "feat: filter jobs by area and region"
```

---

### Task 6: Expose the 2027 Tech preset and visible region badges

**Files:**
- Modify: `features/jobs/job-filter-panel.tsx:1-230`
- Modify: `features/jobs/active-filter-chips.tsx`
- Modify: `features/jobs/jobs-screen.tsx:20-200`
- Modify: `features/jobs/jobs-screen.test.tsx`
- Modify: `lib/format.ts`
- Modify: `app/globals.css:410-525`

**Interfaces:**
- Consumes: Task 5 filters and mapped row fields.
- Produces: accessible preset, area toggles, first-class region selector, chips, and result badges.

- [ ] **Step 1: Write failing UI tests**

Render the Jobs page with fixture options and assert:

```ts
await user.click(screen.getByRole("button", { name: "2027 Tech Internships" }));
expect(mockRepository.searchJobs).toHaveBeenLastCalledWith(expect.objectContaining({
  recruitingYears: [2027],
  programTypes: ["internship", "coop"],
  areas: ["ai-ml", "data-analytics", "software-engineering"],
}));
await user.selectOptions(screen.getByLabelText("Region"), "us");
expect(mockRepository.searchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ regions: ["us"] }));
expect(screen.getByText("US")).toBeVisible();
expect(screen.getByText("Software Engineering")).toBeVisible();
expect(screen.getByText("Posted Aug 8, 2026")).toBeVisible();
```

Add a second fixture with `publishedAt: null` and assert `First seen Aug 7, 2026`. Add desktop and mobile assertions, removable chips, clear-all behavior, deep-link initialization, keyboard focus restoration, and no generic `Employment type` dependency.

- [ ] **Step 2: Run the UI test and confirm failure**

Run: `npx vitest run features/jobs/jobs-screen.test.tsx`

Expected: FAIL because the preset, Region control, and badges are absent.

- [ ] **Step 3: Implement the visible filters**

Rename the quick preset to `2027 Tech Internships`. Keep the AI/Data shortcut by selecting `ai-ml` plus `data-analytics`. Add three accessible area checkboxes in More filters. Add a common-bar Region select with options:

```text
Any region
United States
Outside U.S.
Mixed U.S. / international
Unknown region
```

Use repeated URL values from Task 5 and reset pagination whenever the selection changes.

- [ ] **Step 4: Render result metadata**

Display compact area badges beneath the role title and a location-region badge adjacent to the location on desktop and mobile. Add a `Posted` column using `publishedAt` when present and `firstSeenAt` as an explicitly labelled fallback. Format both as an absolute `MMM D, YYYY` date so results remain understandable after several days. Use full accessible labels (`United States`, `Outside United States`, `Mixed United States and international`, `Unknown region`) even when visual copy is shortened.

- [ ] **Step 5: Style responsive layouts**

Update the common-filter grid so the new Region control does not force horizontal overflow at desktop, tablet, or mobile breakpoints. Add shared `.job-area-badge` and `.job-region-badge` styles that use existing color tokens and preserve a 44px minimum interactive target for controls.

- [ ] **Step 6: Verify UI tests and accessibility lint**

Run: `npx vitest run features/jobs/jobs-screen.test.tsx features/jobs/job-detail-drawer.test.tsx && npm run lint`

Expected: UI tests and lint PASS.

- [ ] **Step 7: Commit the UI task**

```bash
git add features/jobs/job-filter-panel.tsx features/jobs/active-filter-chips.tsx features/jobs/jobs-screen.tsx features/jobs/jobs-screen.test.tsx lib/format.ts app/globals.css
git commit -m "feat: add tech internship and region controls"
```

---

### Task 7: Full verification, production deployment, backfill, and live QA

**Files:**
- Modify if verification reveals a defect: only files introduced or modified in Tasks 1-6.
- Read: `.openai/hosting.json`
- Read: `docs/database.md`

**Interfaces:**
- Consumes: all completed tasks.
- Produces: migrated private Sites deployment, completed production backfill, refreshed facets, and browser-verified live filters.

- [ ] **Step 1: Run the complete local verification suite**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Apply and verify the migration locally**

Run:

```bash
npm run db:migrate:local
npx wrangler d1 execute site-creator-d1 --config wrangler.local.jsonc --local --persist-to .wrangler/state --json --command "PRAGMA table_info(jobs); SELECT name FROM sqlite_master WHERE type='index' AND name='jobs_status_location_region_seen_idx';"
```

Expected: both new columns and the named index are present.

- [ ] **Step 3: Review the completed change set**

Use `superpowers:requesting-code-review` and the repository-required CodeRabbit workflow. Resolve every Critical or Important finding, rerun focused tests after each fix, then rerun Step 1.

- [ ] **Step 4: Push the exact source state and deploy with Sites**

Read `.openai/hosting.json`, reuse project id `appgprj_6a786b4ef3e8819190949950053d1a40`, push the exact committed source state, save a Sites version, and deploy that saved version. Do not create a new site and do not change the custom access allowlist.

- [ ] **Step 5: Run the bounded production backfill**

Call `sites_get_site` once to read the existing SIWC bypass bearer token without generating or rotating it. POST `backfillJobAreasAndRegions` with limit 500 sequentially until `remaining` is 0, then POST `refreshJobFilterOptions`. Stop and report if any HTTP request fails rather than skipping a failed batch.

- [ ] **Step 6: Verify exact production records and counts**

Query the live API for the 2027 preset and assert:

- Motorola Solutions requisition `R67461` appears;
- ConocoPhillips requisition `REQ-006200` appears;
- both SpaceX 2027 Software Engineering internship/co-op URLs appear;
- `Auditor Development Program`, `Sustainable Development`, and generic HR Leadership Development titles do not appear through the Software Engineering area alone;
- repeated official URLs are deduplicated;
- result totals equal the unique official-URL count.

- [ ] **Step 7: Verify region semantics against live results**

Query each region separately and assert every returned row carries the requested region. Confirm at least one U.S., non-U.S., mixed, and unknown fixture when production data contains that class. Record counts for all four so any unexpectedly large unknown share is visible.

- [ ] **Step 8: Run in-app browser QA**

Use `browser:control-in-app-browser` to open the private live Jobs page. Click `2027 Tech Internships`, select each Region option, inspect page 1 and a later page, open at least one job detail, and confirm company, role, area badges, region badge, official link, URL state, pagination, desktop layout, and mobile layout. Do not substitute a different browser surface for this required pass.

- [ ] **Step 9: Commit verification-only fixes and report production state**

If verification required fixes, commit them with a focused message and repeat Steps 1-8. Report final deployed version, unique 2027 Tech Internship count, counts by area and region, and any remaining `unknown` region data-quality limitation.

---

## Self-review record

- Spec coverage: the plan covers narrow Software Engineering semantics, AI/Data/Quant areas, internship/co-op independence from employment type, four-state regions, indexed storage/search, bounded backfill, URL compatibility, honest posted/first-seen timing, responsive UI, private Sites deployment, and live exact-record verification.
- Placeholder scan: the plan contains no deferred implementation markers or unspecified error-handling steps.
- Type consistency: `JobAreaKey`, `JobRegion`, `areas`, `regions`, `areaKeys`, `locationRegion`, and `backfillJobAreasAndRegions` use the same names across classifier, storage, search, API, and UI tasks.
