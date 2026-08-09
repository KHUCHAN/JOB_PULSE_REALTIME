# Structured Job Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add URL-backed, paginated filters for every normalized job attribute and make `Recruiting year = 2027` plus `Internship/Co-op` reproduce the production 2027 program set.

**Architecture:** Add pure filter parsing and SQL-building modules, then expose a paginated `searchJobs` repository boundary backed by D1. The Jobs screen owns URL-backed filter state and composes focused common-filter, advanced-filter, chip, table, and pagination components. Existing crawler storage remains unchanged because the required fields already exist.

**Tech Stack:** TypeScript 5.9, React 19, vinext App Router, Cloudflare D1/SQLite, Vitest, Testing Library, Drizzle migrations, existing CSS design tokens.

## Global Constraints

- Only open jobs are displayed.
- Display totals and rows are deduplicated by normalized official URL.
- Default page size is 50 and maximum page size is 100.
- Stable order is `first_seen_at DESC, company ASC, id ASC`.
- Missing values exclude a job only when the corresponding filter is active.
- Year and program type use title-only semantics; description mentions do not qualify.
- URL state must be bookmarkable and shareable.
- All SQL values are parameterized and invalid filter inputs return HTTP 400.
- High-cardinality option lists are bounded and support text entry.
- Preserve the existing Job Pulse visual system and drawer/review-state workflow.

---

### Task 1: Filter domain and URL codec

**Files:**
- Create: `lib/job-filter-query.ts`
- Create: `lib/job-filter-query.test.ts`
- Modify: `lib/domain.ts`

**Interfaces:**
- Produces: `JobProgramType`, `JobSeason`, expanded `JobFilters`, `JobSearchResult`, `JobFilterOptions`.
- Produces: `defaultJobFilters`, `parseJobFilterParams(input: URLSearchParams): JobFilters`, `serializeJobFilters(filters: JobFilters): URLSearchParams`, `activeFilterCount(filters: JobFilters): number`.

- [ ] **Step 1: Write the failing URL codec tests**

```ts
it("round-trips multi-value structured filters", () => {
  const filters = parseJobFilterParams(new URLSearchParams(
    "year=2027&program=internship&program=coop&company=SpaceX&skill=Python&page=3",
  ));
  expect(filters.recruitingYears).toEqual([2027]);
  expect(filters.programTypes).toEqual(["internship", "coop"]);
  expect(serializeJobFilters(filters).toString()).toContain("page=3");
});

it("drops invalid numeric, date, and enum values", () => {
  const filters = parseJobFilterParams(new URLSearchParams(
    "year=nope&program=contract&page=-1&pageSize=999&postedAfter=tomorrow",
  ));
  expect(filters).toMatchObject({ recruitingYears: [], programTypes: [], page: 1, pageSize: 50 });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- lib/job-filter-query.test.ts`

Expected: FAIL because `job-filter-query` and expanded domain types do not exist.

- [ ] **Step 3: Add domain types and the pure codec**

```ts
export type JobProgramType = "internship" | "coop" | "regular";
export type JobSeason = "spring" | "summer" | "fall" | "winter";

export interface JobSearchResult {
  items: JobPosting[];
  total: number;
  page: number;
  pageSize: number;
  availableFilters: JobFilterOptions;
}

export function parseJobFilterParams(input: URLSearchParams): JobFilters;
export function serializeJobFilters(filters: JobFilters): URLSearchParams;
export function activeFilterCount(filters: JobFilters): number;
```

Normalize repeated values, cap years to 2000-2100, page size to 100, non-negative salary values, and ISO `YYYY-MM-DD` dates. Serialize fields in a fixed order and omit defaults.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- lib/job-filter-query.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/domain.ts lib/job-filter-query.ts lib/job-filter-query.test.ts
git commit -m "feat: define structured job filters"
```

### Task 2: Parameterized D1 search plan

**Files:**
- Create: `lib/job-search-sql.ts`
- Create: `lib/job-search-sql.test.ts`
- Modify: `lib/pulse-mappers.ts`

**Interfaces:**
- Consumes: `JobFilters` from Task 1 and existing `ftsQuery`.
- Produces: `buildJobSearchPlan(filters: JobFilters): { pageSql: string; countSql: string; bindings: unknown[]; limit: number; offset: number }`.
- Produces: rich `JobViewRow` mapping for the structured fields shown in results and the drawer.

- [ ] **Step 1: Write failing SQL-plan tests**

```ts
it("builds title-only 2027 internship and co-op predicates", () => {
  const plan = buildJobSearchPlan({
    ...defaultJobFilters,
    recruitingYears: [2027],
    programTypes: ["internship", "coop"],
  });
  expect(plan.pageSql).toContain("lower(j.title)");
  expect(plan.pageSql).toContain("row_number() OVER (PARTITION BY j.official_url");
  expect(plan.bindings).toEqual(expect.arrayContaining(["%2027%", "%intern%", "%co-op%"]));
});

it("uses json_each for skill and language membership", () => {
  const plan = buildJobSearchPlan({
    ...defaultJobFilters,
    skills: ["Python"],
    languages: ["English"],
  });
  expect(plan.pageSql).toContain("json_each(j.skills)");
  expect(plan.pageSql).toContain("json_each(j.languages)");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- lib/job-search-sql.test.ts`

Expected: FAIL because `buildJobSearchPlan` does not exist.

- [ ] **Step 3: Implement the parameterized builder**

Build predicates for search, review state, company, free-text location, city/state/country, arrangement, employment type, recruiting year, program type, season, publication range, department, team, business unit, family, function, industry, office, skill, experience level, salary bounds/currency/interval, education, shift, travel, clearance, and language. Multi-select values use OR within a field and AND across fields. The page and count queries share one ranked CTE and deduplicate by official URL.

- [ ] **Step 4: Extend the rich row mapper**

Map optional structured columns without changing sparse values into misleading defaults. Continue normalizing unknown arrangement to `onsite` only where existing UI compatibility requires it; expose optional fields as `null` or empty arrays.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm test -- lib/job-search-sql.test.ts lib/pulse-mappers.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/job-search-sql.ts lib/job-search-sql.test.ts lib/pulse-mappers.ts lib/pulse-mappers.test.ts
git commit -m "feat: build parameterized job search queries"
```

### Task 3: Paginated API and filter options

**Files:**
- Modify: `app/api/pulse/route.ts`
- Modify: `lib/api-repository.ts`
- Modify: `lib/api-repository.test.ts`
- Modify: `lib/repository.ts`
- Modify: `lib/fixture-repository.ts`
- Modify: `lib/fixture-repository.test.ts`

**Interfaces:**
- Consumes: `buildJobSearchPlan`, `parseJobFilterParams`, and Task 1 domain types.
- Produces: `JobPulseRepository.searchJobs(filters?: Partial<JobFilters>): Promise<JobSearchResult>`.
- Keeps: `listJobs` only as a compatibility helper if another screen still needs an array.

- [ ] **Step 1: Write failing repository serialization tests**

```ts
it("serializes repeated filters and maps a paginated result", async () => {
  const result = await createApiRepository().searchJobs({
    recruitingYears: [2027],
    programTypes: ["internship", "coop"],
    companies: ["SpaceX"],
    page: 2,
  });
  expect(String(fetcher.mock.calls[0][0])).toContain("year=2027");
  expect(String(fetcher.mock.calls[0][0])).toContain("program=internship");
  expect(result.total).toBe(246);
});
```

- [ ] **Step 2: Run focused repository tests and verify RED**

Run: `npm test -- lib/api-repository.test.ts lib/fixture-repository.test.ts`

Expected: FAIL because `searchJobs` does not exist.

- [ ] **Step 3: Implement repository boundaries**

Use `serializeJobFilters` for the live URL. Make the fixture repository apply the same observable filter semantics, deduplicate official URLs, paginate, and generate bounded options from fixture data.

- [ ] **Step 4: Replace the route's jobs query**

Parse query parameters, execute the page and count plans, and return:

```ts
{
  items,
  total,
  page: filters.page,
  pageSize: filters.pageSize,
  availableFilters,
}
```

Build bounded filter values from current open jobs, with counts, and cache them in-process for 10 minutes. Return HTTP 400 for invalid explicitly supplied numeric/date values rather than silently widening production queries.

- [ ] **Step 5: Preserve overview behavior**

Have `overview()` request a page size of five from the same query function and assign `latestJobs` from `result.items`. Do not compute filter options for overview.

- [ ] **Step 6: Run focused and route-adjacent tests**

Run: `npm test -- lib/api-repository.test.ts lib/fixture-repository.test.ts lib/job-filter-query.test.ts lib/job-search-sql.test.ts lib/pulse-mappers.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/pulse/route.ts lib/api-repository.ts lib/api-repository.test.ts lib/repository.ts lib/fixture-repository.ts lib/fixture-repository.test.ts
git commit -m "feat: expose paginated job filters"
```

### Task 4: Jobs filter controls and URL-backed state

**Files:**
- Create: `features/jobs/job-filter-panel.tsx`
- Create: `features/jobs/active-filter-chips.tsx`
- Modify: `features/jobs/jobs-screen.tsx`
- Modify: `features/jobs/jobs-screen.test.tsx`
- Modify: `features/jobs/job-detail-drawer.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `JobSearchResult`, `JobFilters`, codec helpers, and `repository.searchJobs`.
- Produces: accessible common controls, advanced sheet, active chips, result total, and pagination.

- [ ] **Step 1: Write the failing 2027 filter workflow test**

```tsx
it("applies 2027 internship and co-op filters and exposes removable chips", async () => {
  render(<FixtureProvider><JobsScreen initialQuery="" /></FixtureProvider>);
  await user.click(screen.getByRole("button", { name: /More filters/ }));
  await user.selectOptions(screen.getByLabelText("Recruiting year"), "2027");
  await user.click(screen.getByLabelText("Internship"));
  await user.click(screen.getByLabelText("Co-op"));
  expect(await screen.findByText(/roles found/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove Recruiting year: 2027" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Write failing clear-all, URL, and pagination tests**

Test that active controls write canonical query parameters with `history.replaceState`, removing a chip resets page to 1, `Clear all` restores defaults, and Next/Previous request stable pages.

- [ ] **Step 3: Run Jobs screen tests and verify RED**

Run: `npm test -- features/jobs/jobs-screen.test.tsx`

Expected: FAIL because the advanced controls and paginated result UI do not exist.

- [ ] **Step 4: Implement focused components**

`JobFilterPanel` renders the five common controls and an accessible advanced sheet. Use searchable text inputs with `<datalist>` for high-cardinality values, checkboxes for program type and season, and native date/number inputs for ranges. `ActiveFilterChips` renders named removal buttons and `Clear all`.

- [ ] **Step 5: Refactor JobsScreen coordination**

Initialize filters from `window.location.search` merged with `initialQuery`, debounce search text by 250ms, request `repository.searchJobs`, ignore stale promise completions, replace URL state after changes, display the server total, and preserve selection/focus behavior for the detail drawer. Render 50 rows per page with Previous/Next controls.

- [ ] **Step 6: Show structured fields in job details**

Add compact labeled sections for employment type, department/function, skills, experience, salary, posting date, and languages only when values exist. Keep the official application link and review-state actions unchanged.

- [ ] **Step 7: Style desktop and mobile states**

Reuse existing colors, radii, borders, typography, button classes, and drawer backdrop. Prevent control wrapping and clipped labels at 1290px, 1024px, and 390px widths. Respect `prefers-reduced-motion`.

- [ ] **Step 8: Run component tests and verify GREEN**

Run: `npm test -- features/jobs/jobs-screen.test.tsx components/app-quality.test.tsx components/app-shell.test.tsx`

Expected: PASS with no React act warnings.

- [ ] **Step 9: Commit**

```bash
git add features/jobs app/globals.css
git commit -m "feat: add advanced job filter UI"
```

### Task 5: Query indexes, production verification, and deployment

**Files:**
- Modify: `db/schema.ts`
- Modify: `db/schema.test.ts`
- Create: generated immutable Drizzle migration
- Modify: `build/sites-migrations.ts` only if the schema-only migration allowlist is explicit rather than automatic

**Interfaces:**
- Consumes: final predicates observed in Task 2.
- Produces: indexes for the common equality/range predicates without changing job data.

- [ ] **Step 1: Write the failing schema index assertions**

Assert indexes exist for status/company, status/arrangement, status/employment type, status/published date, location country/state/city, experience level, and salary currency/min/max.

- [ ] **Step 2: Run schema tests and verify RED**

Run: `npm test -- db/schema.test.ts`

Expected: FAIL because the new indexes are absent.

- [ ] **Step 3: Add schema indexes and generate one immutable migration**

Run: `npm run db:generate`

Inspect the generated SQL and ensure it contains only additive `CREATE INDEX` statements for this task.

- [ ] **Step 4: Verify the local production-size query**

Run the structured `2027 + Internship/Co-op` query against the persisted local D1 database. Confirm unique official URLs, exact count, first and last page, and `EXPLAIN QUERY PLAN`. Confirm common company/location combinations respond within the Worker request budget.

- [ ] **Step 5: Commit the additive indexes**

```bash
git add db/schema.ts db/schema.test.ts drizzle build/sites-migrations.ts
git commit -m "perf: index structured job filters"
```

- [ ] **Step 6: Run the complete verification suite**

Run: `npm test && npm run typecheck && npm run lint && npm run build && npm run test:html`

Expected: all commands exit 0 with no test failures, TypeScript errors, lint errors, or build errors.

- [ ] **Step 7: Browser QA**

Use the in-app browser first. Verify the Jobs page at desktop and mobile widths, apply `2027`, `Internship`, and `Co-op`, traverse at least three pages, combine company/location/season filters, remove chips, clear all, open a job drawer, and follow an official link target without altering external state. Capture the final implementation screenshot and inspect it with `view_image`; because this is a small extension of the existing accepted design system, compare against the pre-change Jobs page screenshot rather than generating a new concept.

- [ ] **Step 8: Push, save, and privately deploy**

Commit the verified source, push the exact branch head, package the validated Sites build with schema-only migrations, save one Sites version, and deploy it with the existing owner-only access. Do not change access or generate a new SIWC token.

- [ ] **Step 9: Verify production data and exact filter semantics**

Call the live Jobs API with the existing bypass token. Confirm the structured filter total matches a direct title-qualified count, pages contain no duplicate official URLs, result titles include 2027 and Internship/Co-op semantics, and overview/source counts remain healthy. Open the deployed URL in Codex only after the deployment reports success.
