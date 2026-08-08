# Full Source Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crawl every enabled Job Pulse source with HTTP requests and JavaScript parsing, then persist reliable open-job changes to D1.

**Architecture:** A request-only crawler first discovers public ATS endpoints from each official posting URL, then dispatches to a bounded set of adapters. Known listing APIs report complete listings and can close absent jobs; generic HTML extraction only inserts or refreshes visible jobs. The scheduled worker runs sources concurrently, writes per-source run state, and records unsupported/blocked endpoints for later adapter additions.

**Tech Stack:** Cloudflare Workers, D1/SQLite, TypeScript, native `fetch`, Vitest, Wrangler local scheduled events.

## Global Constraints

- Use HTTP requests and JavaScript parsers only; do not drive a browser, log in, submit forms, solve CAPTCHA, or upload files.
- Preserve the two-hour schedule and share the site D1 binding named `DB`.
- Close jobs only after an adapter confirms a complete listing.
- Cap per-source pages at 20 and scheduled batch concurrency at 8.
- Use test-first development for every new adapter and runner behavior.

---

### Task 1: Add an adapter discovery contract

**Files:**
- Modify: `lib/crawler.ts`
- Test: `lib/crawler.test.ts`

**Interfaces:**
- Produces `crawlSource(source, fetcher, now): Promise<SourceCrawlResult>`.
- Adds `discoverAts(html, pageUrl): DiscoveredAts | null` for recognized public careers links.

- [ ] **Step 1: Write the failing tests**

```ts
expect(discoverAts('<a href="https://jobs.lever.co/acme">Jobs</a>', 'https://acme.com/careers'))
  .toEqual({ kind: 'lever', endpoint: 'https://api.lever.co/v0/postings/acme?mode=json' });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run lib/crawler.test.ts`
Expected: FAIL because `discoverAts` does not exist.

- [ ] **Step 3: Implement the smallest recognizer**

```ts
const leverMatch = html.match(/https:\/\/jobs\.lever\.co\/([\w-]+)/i);
return leverMatch ? { kind: 'lever', endpoint: `https://api.lever.co/v0/postings/${leverMatch[1]}?mode=json` } : null;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run lib/crawler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/crawler.ts lib/crawler.test.ts
git commit -m "feat: discover public ATS endpoints"
```

### Task 2: Add public Lever and SmartRecruiters listing adapters

**Files:**
- Modify: `lib/crawler.ts`
- Test: `lib/crawler.test.ts`

**Interfaces:**
- Consumes `DiscoveredAts` from Task 1.
- Produces complete `CrawledJob[]` for public Lever and SmartRecruiters JSON feeds.

- [ ] **Step 1: Write failing adapter tests**

```ts
expect(result.jobs[0]).toMatchObject({
  externalId: 'lever-id', title: 'Risk Analyst', officialUrl: 'https://jobs.lever.co/acme/lever-id'
});
expect(result.completeListing).toBe(true);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run lib/crawler.test.ts`
Expected: FAIL because the discovered feeds are parsed as HTML.

- [ ] **Step 3: Implement JSON normalizers**

```ts
const jobs = payload.map((job) => ({
  externalId: job.id, title: job.text, officialUrl: job.hostedUrl, location: job.categories?.location ?? null,
}));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run lib/crawler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/crawler.ts lib/crawler.test.ts
git commit -m "feat: crawl public lever and smartrecruiters feeds"
```

### Task 3: Record discovery coverage and safe source outcomes

**Files:**
- Modify: `lib/crawl-runner.ts`, `worker/crawl-store.ts`
- Test: `lib/crawl-runner.test.ts`

**Interfaces:**
- Consumes `SourceCrawlResult.completeListing`.
- Produces `crawl_runs` rows with response status, error text, and created/updated/closed counters.

- [ ] **Step 1: Write the failing runner test**

```ts
expect(store.runs).toEqual([expect.objectContaining({ status: 'failed', error: 'D1 unavailable' })]);
```

- [ ] **Step 2: Run it to verify failure**

Run: `npm test -- --run lib/crawl-runner.test.ts`
Expected: FAIL because a failed persistence call rejects the batch.

- [ ] **Step 3: Catch and record a single-source persistence failure**

```ts
try { changes = await store.syncJobs(...); }
catch (error) { status = 'failed'; errorText = error.message; }
```

- [ ] **Step 4: Run it to verify success**

Run: `npm test -- --run lib/crawl-runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/crawl-runner.ts lib/crawl-runner.test.ts worker/crawl-store.ts
git commit -m "fix: isolate failed crawler sources"
```

### Task 4: Run and classify the complete source set

**Files:**
- Create: `scripts/audit-crawler-coverage.ts`
- Modify: `docs/crawler.md`

**Interfaces:**
- Consumes `db/seed/sources.json` and the adapter discovery functions.
- Produces `outputs/crawler-coverage.json` with one result per source and aggregate adapter/status counts.

- [ ] **Step 1: Write a failing fixture test for the report shape**

```ts
expect(report).toEqual({ total: 2, byStatus: { succeeded: 1, failed: 1 }, sources: expect.any(Array) });
```

- [ ] **Step 2: Run it to verify failure**

Run: `npm test -- --run scripts/audit-crawler-coverage.test.ts`
Expected: FAIL because the reporting function does not exist.

- [ ] **Step 3: Implement bounded concurrent audit execution**

```ts
const report = await runCoverageAudit(sources, fetch, { concurrency: 8, timeoutMs: 15_000 });
```

- [ ] **Step 4: Run the fixture test and then the real report**

Run: `npm test -- --run scripts/audit-crawler-coverage.test.ts && npm run crawler:audit`
Expected: fixture PASS and a 445-source JSON report.

- [ ] **Step 5: Commit**

```bash
git add scripts/audit-crawler-coverage.ts scripts/audit-crawler-coverage.test.ts docs/crawler.md package.json
git commit -m "feat: audit crawler coverage across all sources"
```

## Self-Review

- Adapter discovery and public API parsers cover more sources without using browser automation.
- Runner isolation and complete-listing safeguards keep D1 job state trustworthy.
- The report explicitly distinguishes successful extraction from an unsupported page, so no site is silently counted as complete.
- All endpoint requests use the same bounded concurrency and request-only constraints.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-08-full-source-crawler.md`. The user requested full execution, so proceed inline using `superpowers:executing-plans`.
