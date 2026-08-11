# Resume Match Gmail Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an explainable U.S. internship resume-match filter and send newly discovered matches from `kimchany@usc.edu` to `kimchany@usc.edu` and `lupeter@usc.edu` every two hours through Gmail API.

**Architecture:** A pure deterministic matcher scores normalized job data against one versioned resume profile. D1 stores profile configuration, generation-specific match evidence, recipient-specific delivery reservations, and Gmail delivery state; bounded crawl persistence classifies touched jobs while a leased dispatcher sends due digests without duplicates. The existing Jobs and Alerts surfaces expose the profile filter, score evidence, Gmail status, and test delivery.

**Tech Stack:** TypeScript 5.9, React 19, Next.js App Router through vinext, Cloudflare Workers and D1, Drizzle ORM/migrations, Gmail REST API, Vitest, Testing Library.

## Global Constraints

- Preserve the existing private Sites access policy and project id `appgprj_6a786b4ef3e8819190949950053d1a40`.
- Match only canonical open U.S. internship/co-op jobs; 2027 is a positive signal, not a hard gate.
- Do not email pre-activation baseline matches.
- Send each new or genuinely reopened job exactly once to each enabled recipient.
- Use only Gmail scope `https://www.googleapis.com/auth/gmail.send`.
- Store Gmail client id, client secret, refresh token, and sender only as Sites production secrets.
- Never store the resume PDF, full extracted resume text, OAuth secrets, Gmail bodies, or raw provider errors in Git, D1, logs, or archives.
- Keep every D1 payload below 1,500,000 JSON bytes and every Worker invocation within its query budget.
- Use additive immutable migrations and snapshot/journal entries; never rewrite an applied migration.
- Write each behavior test first, run it to observe the intended failure, then add the minimum implementation and rerun.
- Preserve existing crawler leases, sparse refresh behavior, facet safety, canonical URL deduplication, filters, and closure logic.

---

## File map

**Create**

- `lib/resume-match.ts`: pure profile configuration, normalization, eligibility, scoring, and stable evidence.
- `lib/resume-match.test.ts`: table-driven matcher and false-positive tests.
- `lib/resume-match-store.ts`: D1 profile lookup, touched-job match synchronization, baseline backfill, and lease-safe activation.
- `lib/resume-match-store.test.ts`: real SQLite persistence, generation, baseline, and concurrency tests.
- `lib/resume-alert-store.ts`: digest planning, notification item reservation, leases, retry state, and status read model.
- `lib/resume-alert-store.test.ts`: real SQLite idempotency and retry tests.
- `lib/gmail-message.ts`: plain-text/HTML MIME creation and base64url encoding.
- `lib/gmail-message.test.ts`: deterministic MIME safety and content tests.
- `lib/gmail-client.ts`: OAuth refresh and Gmail send HTTP boundary.
- `lib/gmail-client.test.ts`: token/send contract tests with an injected fetcher.
- `lib/resume-alert-service.ts`: due-digest orchestration over store and Gmail client.
- `lib/resume-alert-service.test.ts`: two-recipient success, partial failure, auth block, and retry tests.
- `features/alerts/resume-alert-card.tsx`: Gmail status and controls.
- `features/alerts/resume-alert-card.test.tsx`: UI status and mutation tests.
- `drizzle/0046_resume_match_gmail_alerts.sql`: immutable schema/profile seed migration generated from schema.
- `drizzle/meta/0046_snapshot.json`: Drizzle snapshot chained from 0045.

**Modify**

- `db/schema.ts`: profile, recipient, notification item tables and new job/match/notification fields and indexes.
- `drizzle/meta/_journal.json`: append migration 0046.
- `lib/domain.ts`: resume filter, match evidence, and alert status contracts.
- `lib/pulse-mappers.ts`: map resume score/evidence fields.
- `lib/job-filter-query.ts`: parse/serialize `resumeMatch` and score.
- `lib/job-filter-query.test.ts`: URL codec coverage.
- `lib/job-search-sql.ts`: profile filter, projection, count, and score ordering.
- `lib/job-search-sql.test.ts`: canonical filter and index-plan behavior.
- `worker/crawl-store.ts`: reopen generation and touched-job resume synchronization.
- `worker/crawl-store.test.ts`: reopen and profile match integration.
- `lib/crawl-runner.ts`: preserve public crawl counts while allowing internal post-sync match work.
- `app/api/pulse/route.ts`: profile/status reads, backfill, enable, test email, and due-dispatch integration.
- `lib/repository.ts`: resume alert repository methods.
- `lib/api-repository.ts`: new API requests.
- `lib/api-repository.test.ts`: request contract coverage.
- `lib/fixture-repository.ts`: demo-compatible resume status and mutations.
- `features/jobs/job-filter-panel.tsx`: `My Resume Match` preset.
- `features/jobs/jobs-screen.tsx`: score ordering, evidence, and profile filter.
- `features/jobs/jobs-screen.test.tsx`: preset and evidence rendering.
- `features/jobs/job-detail-drawer.tsx`: `Why this matches`.
- `features/jobs/job-detail-drawer.test.tsx`: evidence and caution rendering.
- `features/jobs/active-filter-chips.tsx`: removable resume-match chip.
- `features/alerts/alerts-screen.tsx`: mount the resume email card.
- `components/fixture-provider.tsx`: expose new repository results unchanged.
- `app/globals.css`: responsive match evidence and Gmail status styles.
- `worker/crawler.ts`: invoke the same bounded alert processor after scheduled crawl batches.
- `.env.example`: list Gmail secret key names with empty values only.
- `worker-configuration.d.ts`: regenerate Cloudflare environment typing after secret declarations are used.
- `scripts/prepare-sites-package.ts`: ensure migration 0046 remains included by existing migration staging checks.

---

### Task 1: Add the resume alert schema and immutable migration

**Files:**
- Modify: `db/schema.ts`
- Create: `lib/resume-match-store.test.ts`
- Create: `drizzle/0046_resume_match_gmail_alerts.sql`
- Create: `drizzle/meta/0046_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Produces: D1 tables `match_profiles`, `profile_recipients`, and `notification_items`.
- Produces: `jobs.open_generation`, `job_matches.open_generation`, `job_matches.is_active`, and `job_matches.notification_eligible`.
- Produces: notification state fields `attempt_count`, `next_retry_at`, `lease_owner`, and `lease_expires_at`.
- Consumes: existing `keywords`, `job_matches`, `notifications`, and `jobs` tables.

- [ ] **Step 1: Write a failing migration behavior test**

```ts
it("supports a baseline resume match and recipient-specific delivery reservation", () => {
  const db = migratedSqlite();
  const columns = db.prepare("PRAGMA table_info(job_matches)").all() as Array<{ name: string }>;
  expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
    "open_generation", "is_active", "notification_eligible",
  ]));
  db.prepare("INSERT INTO profile_recipients (profile_id, recipient, enabled) VALUES (?, ?, 1)")
    .run("chanyoung-resume", "kimchany@usc.edu");
  expect(() => db.prepare(
    "INSERT INTO profile_recipients (profile_id, recipient, enabled) VALUES (?, ?, 1)",
  ).run("chanyoung-resume", "kimchany@usc.edu")).toThrow();
});
```

- [ ] **Step 2: Run the schema test and verify the missing-table failure**

Run: `npx vitest run lib/resume-match-store.test.ts`

Expected: FAIL because `match_profiles` and the new columns do not exist.

- [ ] **Step 3: Add focused Drizzle schema definitions**

```ts
export const matchProfiles = sqliteTable("match_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  keywordId: text("keyword_id").notNull().references(() => keywords.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  ruleVersion: text("rule_version").notNull(),
  rulesJson: text("rules_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  minScore: integer("min_score").notNull().default(60),
  activationWatermark: text("activation_watermark"),
  nextDigestAt: text("next_digest_at"),
  evaluationLeaseOwner: text("evaluation_lease_owner"),
  evaluationLeaseExpiresAt: text("evaluation_lease_expires_at"),
  dispatchLeaseOwner: text("dispatch_lease_owner"),
  dispatchLeaseExpiresAt: text("dispatch_lease_expires_at"),
  gmailState: text("gmail_state", { enum: ["unconfigured", "connected", "blocked"] }).notNull().default("unconfigured"),
  lastDigestAt: text("last_digest_at"),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("match_profiles_keyword_unique").on(table.keywordId),
  index("match_profiles_enabled_digest_idx").on(table.enabled, table.nextDigestAt),
]);

export const profileRecipients = sqliteTable("profile_recipients", {
  profileId: text("profile_id").notNull().references(() => matchProfiles.id, { onDelete: "cascade" }),
  recipient: text("recipient").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.profileId, table.recipient] }),
]);

export const notificationItems = sqliteTable("notification_items", {
  id: text("id").primaryKey(),
  notificationId: text("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
  jobMatchId: text("job_match_id").notNull().references(() => jobMatches.id, { onDelete: "cascade" }),
  recipient: text("recipient").notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("notification_items_match_recipient_unique").on(table.jobMatchId, table.recipient),
  index("notification_items_notification_idx").on(table.notificationId),
]);
```

Add integer defaults for `jobs.openGeneration`, `jobMatches.openGeneration`, `jobMatches.isActive`, and `jobMatches.notificationEligible`. Extend the notification status enum to `queued | sending | sent | retryable | auth_blocked | failed` and add the retry/lease fields.

- [ ] **Step 4: Generate and inspect migration 0046**

Run: `npm run db:generate -- --name resume_match_gmail_alerts`

Expected: a new 0046 SQL file, snapshot chained from 0045, and one appended journal entry. Inspect that the old `job_matches_job_keyword_unique` index is dropped and replaced by a unique index over `(job_id, keyword_id, open_generation)`.

- [ ] **Step 5: Add deterministic profile seed rows to migration 0046**

```sql
INSERT OR IGNORE INTO keywords (
  id, name, include_terms, exclude_terms, locations, enabled, delivery_mode
) VALUES (
  'resume-keyword-chanyoung',
  'Chanyoung Resume Match',
  '[]', '[]', '["United States"]', 1, 'immediate'
);

INSERT OR IGNORE INTO match_profiles (
  id, name, keyword_id, enabled, rule_version, rules_json, min_score, gmail_state
) VALUES (
  'chanyoung-resume',
  'Chanyoung Resume Match',
  'resume-keyword-chanyoung',
  0,
  'resume-v1',
  '{"region":"us","programs":["internship","coop"],"graduation":"2027-12","deliveryMinutes":120}',
  60,
  'unconfigured'
);

INSERT OR IGNORE INTO profile_recipients (profile_id, recipient, enabled) VALUES
  ('chanyoung-resume', 'kimchany@usc.edu', 1),
  ('chanyoung-resume', 'lupeter@usc.edu', 1);
```

- [ ] **Step 6: Run migration tests and inspect index usage**

Run: `npx vitest run lib/resume-match-store.test.ts`

Run: `npm run db:migrate:local`

Run: `npm run db:verify:local`

Expected: PASS; both recipients exist once, and SQLite reports the new unique/index definitions.

- [ ] **Step 7: Commit the schema**

```bash
git add db/schema.ts drizzle/0046_resume_match_gmail_alerts.sql drizzle/meta/0046_snapshot.json drizzle/meta/_journal.json lib/resume-match-store.test.ts
git commit -m "feat: add resume alert persistence"
```

---

### Task 2: Implement the pure resume matcher

**Files:**
- Create: `lib/resume-match.ts`
- Create: `lib/resume-match.test.ts`

**Interfaces:**
- Produces: `evaluateResumeMatch(input: ResumeMatchInput): ResumeMatchDecision`.
- Produces: `CHANYOUNG_RESUME_PROFILE` with rule version `resume-v1` and threshold 60.
- Consumes: normalized job fields only; no D1, fetch, or environment dependencies.

- [ ] **Step 1: Write failing positive and negative table tests**

```ts
const base = {
  id: "job-1",
  title: "Machine Learning Intern",
  company: "Acme",
  locationRegion: "us" as const,
  programKeys: ["internship"] as const,
  summary: "",
  description: "",
  responsibilities: "",
  qualifications: "",
  skills: ["Python", "SQL"],
  jobFamily: null,
  jobFunction: null,
  educationRequirements: null,
  experienceRequirements: null,
  securityClearance: null,
  recruitingYears: [2027],
  publishedAt: "2026-08-10T00:00:00.000Z",
  firstSeenAt: "2026-08-10T00:00:00.000Z",
};

it.each([
  ["LLM Evaluation Intern", ["Python", "NLP"], "role:llm-nlp"],
  ["Data Engineering Co-op", ["SQL", "PySpark"], "role:data-engineering"],
  ["Software Developer Intern", ["JavaScript"], "role:software-engineering"],
  ["Fraud Analytics Internship", ["Python", "SQL"], "domain:aml-risk"],
])("matches %s with stable evidence", (title, skills, evidence) => {
  const result = evaluateResumeMatch({ ...base, title, skills });
  expect(result.eligible).toBe(true);
  expect(result.score).toBeGreaterThanOrEqual(60);
  expect(result.evidence.map((item) => item.code)).toContain(evidence);
});

it.each([
  ["Internal Audit Analyst", "us", ["internship"]],
  ["AI Recruiting Intern", "us", ["internship"]],
  ["Machine Learning Intern", "non_us", ["internship"]],
  ["Machine Learning Engineer", "us", ["regular"]],
  ["PhD Research Scientist Intern", "us", ["internship"]],
  ["High School Software Intern", "us", ["internship"]],
])("rejects ineligible %s", (title, locationRegion, programKeys) => {
  expect(evaluateResumeMatch({ ...base, title, locationRegion, programKeys }).eligible).toBe(false);
});
```

- [ ] **Step 2: Run the matcher tests and verify the missing-export failure**

Run: `npx vitest run lib/resume-match.test.ts`

Expected: FAIL because `evaluateResumeMatch` is not defined.

- [ ] **Step 3: Implement explicit contracts and token-boundary normalization**

```ts
export interface ResumeMatchInput {
  id: string;
  title: string;
  company: string;
  locationRegion: "us" | "non_us" | "mixed" | "unknown";
  programKeys: readonly string[];
  summary: string | null;
  description: string | null;
  responsibilities: string | null;
  qualifications: string | null;
  skills: readonly string[];
  jobFamily: string | null;
  jobFunction: string | null;
  educationRequirements: string | null;
  experienceRequirements: string | null;
  securityClearance: string | null;
  recruitingYears: readonly number[];
  publishedAt: string | null;
  firstSeenAt: string;
}

export interface ResumeMatchEvidence {
  code: string;
  label: string;
  points: number;
}

export interface ResumeMatchDecision {
  eligible: boolean;
  score: number;
  evidence: ResumeMatchEvidence[];
  exclusion: string | null;
}

const normalize = (value: string): string => value
  .normalize("NFKC")
  .toLocaleLowerCase()
  .replace(/[‐‑‒–—]/g, "-")
  .replace(/[^\p{L}\p{N}+#./-]+/gu, " ")
  .replace(/\s+/g, " ")
  .trim();
```

Implement independent gate, role, skill, domain, education, year, and freshness scorers. Require one role evidence code and cap the sum at 100.

- [ ] **Step 4: Add boundary and authorization tests**

```ts
it.each(["internal", "international", "internet"])("does not tokenize %s as intern", (word) => {
  expect(evaluateResumeMatch({ ...base, title: `${word} audit analyst` }).eligible).toBe(false);
});

it.each([
  "Must be a U.S. citizen",
  "Active Secret clearance required",
])("rejects explicit authorization gate: %s", (qualifications) => {
  expect(evaluateResumeMatch({ ...base, qualifications }).eligible).toBe(false);
});

it("does not reject a generic no-sponsorship statement", () => {
  const result = evaluateResumeMatch({
    ...base,
    qualifications: "Sponsorship is not available for this position.",
  });
  expect(result.eligible).toBe(true);
});
```

- [ ] **Step 5: Run matcher tests and refactor repeated phrase checks**

Run: `npx vitest run lib/resume-match.test.ts`

Expected: PASS with stable literal scores and evidence codes.

- [ ] **Step 6: Commit the matcher**

```bash
git add lib/resume-match.ts lib/resume-match.test.ts
git commit -m "feat: score resume internship matches"
```

---

### Task 3: Persist touched-job matches, reopen generations, and baseline backfill

**Files:**
- Create: `lib/resume-match-store.ts`
- Modify: `lib/resume-match-store.test.ts`
- Modify: `worker/crawl-store.ts`
- Modify: `worker/crawl-store.test.ts`
- Modify: `lib/crawl-runner.ts`

**Interfaces:**
- Consumes: `evaluateResumeMatch`, profile id `chanyoung-resume`, and compact touched URL records.
- Produces: `syncResumeMatches(database, candidates, now): Promise<{ matched: number; deactivated: number }>`.
- Produces: `backfillResumeMatches(database, { afterId, limit }): Promise<ResumeBackfillResult>`.
- Preserves: public crawl result fields `created`, `updated`, and `closed`.

- [ ] **Step 1: Write failing tests for baseline, new, refresh, and reopen**

```ts
it("keeps baseline matches visible but notification-ineligible", async () => {
  const db = resumeDatabase({ activationWatermark: "2026-08-10T12:00:00.000Z" });
  insertJob(db, { id: "old", firstSeenAt: "2026-08-10T11:00:00.000Z", title: "Data Science Intern" });
  await backfillResumeMatches(db, { afterId: null, limit: 100 });
  expect(readMatch(db, "old")).toMatchObject({ isActive: 1, notificationEligible: 0 });
});

it("marks a post-watermark new match eligible exactly once", async () => {
  const db = resumeDatabase({ activationWatermark: "2026-08-10T12:00:00.000Z" });
  await syncResumeMatches(db, [candidate({ id: "new", firstSeenAt: "2026-08-10T12:01:00.000Z" })], "2026-08-10T12:01:00.000Z");
  await syncResumeMatches(db, [candidate({ id: "new", firstSeenAt: "2026-08-10T12:01:00.000Z" })], "2026-08-10T12:02:00.000Z");
  expect(countMatches(db, "new")).toBe(1);
  expect(readMatch(db, "new").notificationEligible).toBe(1);
});
```

- [ ] **Step 2: Run store tests and verify behavior is absent**

Run: `npx vitest run lib/resume-match-store.test.ts`

Expected: FAIL because sync/backfill functions are missing.

- [ ] **Step 3: Implement bulk profile match upsert**

```ts
export interface ResumeMatchCandidate extends ResumeMatchInput {
  openGeneration: number;
}

export async function syncResumeMatches(
  database: D1Database,
  candidates: ResumeMatchCandidate[],
  now: string,
): Promise<{ matched: number; deactivated: number }> {
  const profile = await activeProfile(database);
  if (!profile || candidates.length === 0) return { matched: 0, deactivated: 0 };
  const decisions = candidates.map((candidate) => ({
    candidate,
    decision: evaluateResumeMatch(candidate),
  }));
  return persistDecisions(database, profile, decisions, now, false);
}
```

Use compact JSON arrays and `json_each(?)` to upsert active matches in chunks under 1,500,000 bytes. Set `notification_eligible = 1` only when `first_seen_at > activation_watermark` or the current generation was reopened after activation. Mark the current-generation match inactive when a refreshed job no longer qualifies; do not delete delivery history.

- [ ] **Step 4: Implement keyset baseline backfill**

```ts
export interface ResumeBackfillResult {
  processed: number;
  matched: number;
  nextCursor: string | null;
  remaining: number;
}

export async function backfillResumeMatches(
  database: D1Database,
  options: { afterId: string | null; limit: number },
): Promise<ResumeBackfillResult> {
  const limit = Math.max(1, Math.min(500, Math.trunc(options.limit)));
  const rows = await loadCanonicalCandidates(database, options.afterId, limit);
  await persistDecisions(database, await requiredProfile(database), rows.map((candidate) => ({
    candidate,
    decision: evaluateResumeMatch(candidate),
  })), new Date().toISOString(), true);
  return {
    processed: rows.length,
    matched: rows.filter((row) => evaluateResumeMatch(row).eligible).length,
    nextCursor: rows.length === limit ? rows.at(-1)!.id : null,
    remaining: rows.length === limit ? -1 : 0,
  };
}
```

Candidate SQL must canonicalize by official URL before profile gates and scan by `j.id > ?`. Baseline persistence always sets `notification_eligible = 0`.

- [ ] **Step 5: Add reopen generation to crawl upsert**

Expand the existing pre-read to return status and generation for every touched URL. Add `open_generation` to the insert and use:

```sql
open_generation = CASE
  WHEN jobs.status = 'closed' THEN jobs.open_generation + 1
  ELSE jobs.open_generation
END,
status = 'open',
closed_at = NULL
```

After all bounded job/topic/program upserts, load compact touched candidates once and call `syncResumeMatches`. Do not return candidate ids in the public crawl result.

- [ ] **Step 6: Run crawl-store query-budget and reopen tests**

Run: `npx vitest run worker/crawl-store.test.ts lib/resume-match-store.test.ts`

Expected: PASS; a 10,000-job fixture remains within the established D1 invocation budget and a closed job increments only once when reopened.

- [ ] **Step 7: Commit persistence integration**

```bash
git add lib/resume-match-store.ts lib/resume-match-store.test.ts worker/crawl-store.ts worker/crawl-store.test.ts lib/crawl-runner.ts
git commit -m "feat: persist resume matches during crawls"
```

---

### Task 4: Add resume-match search semantics and the Jobs preset

**Files:**
- Modify: `lib/domain.ts`
- Modify: `lib/pulse-mappers.ts`
- Modify: `lib/job-filter-query.ts`
- Modify: `lib/job-filter-query.test.ts`
- Modify: `lib/job-search-sql.ts`
- Modify: `lib/job-search-sql.test.ts`
- Modify: `features/jobs/job-filter-panel.tsx`
- Modify: `features/jobs/jobs-screen.tsx`
- Modify: `features/jobs/jobs-screen.test.tsx`
- Modify: `features/jobs/job-detail-drawer.tsx`
- Modify: `features/jobs/job-detail-drawer.test.tsx`
- Modify: `features/jobs/active-filter-chips.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `JobFilters.resumeMatchProfile?: "chanyoung-resume"`.
- Produces: `RichJobPosting.resumeMatchScore: number | null` and `resumeMatchEvidence: string[]`.
- Consumes: active `job_matches` rows joined through `match_profiles.keyword_id`.

- [ ] **Step 1: Write a failing URL codec test**

```ts
it("round-trips the personal resume preset as an atomic profile id", () => {
  const filters = parseJobFilterParams(new URLSearchParams(
    "resumeMatch=chanyoung-resume&region=us&program=internship&program=coop",
  ));
  expect(filters.resumeMatchProfile).toBe("chanyoung-resume");
  expect(serializeJobFilters(filters).get("resumeMatch")).toBe("chanyoung-resume");
});
```

- [ ] **Step 2: Run codec tests and verify the profile is ignored**

Run: `npx vitest run lib/job-filter-query.test.ts`

Expected: FAIL because `resumeMatchProfile` is absent.

- [ ] **Step 3: Add domain and URL contracts**

```ts
export interface JobFilters {
  // existing fields
  resumeMatchProfile?: "chanyoung-resume";
}

export interface ResumeMatchSummary {
  score: number;
  evidence: string[];
}
```

Parse only the allowlisted profile id and serialize it as `resumeMatch`. Include it in active filter counts and removal.

- [ ] **Step 4: Write failing SQL semantics tests**

```ts
it("filters active matches and orders by score before posting freshness", () => {
  const plan = buildJobSearchPlan({
    ...defaultJobFilters,
    resumeMatchProfile: "chanyoung-resume",
    regions: ["us"],
    programTypes: ["internship", "coop"],
  });
  expect(plan.pageSql).toContain("resume_match.is_active = 1");
  expect(plan.pageSql).toContain("ORDER BY resume_match.score DESC");
  expect(plan.bindings).toContain("chanyoung-resume");
});
```

- [ ] **Step 5: Implement profile join, projection, count, and ordering**

When the profile is selected, join once:

```sql
JOIN match_profiles selected_profile
  ON selected_profile.id = ?
JOIN job_matches resume_match
  ON resume_match.keyword_id = selected_profile.keyword_id
 AND resume_match.job_id = j.id
 AND resume_match.open_generation = j.open_generation
 AND resume_match.is_active = 1
```

Project `resume_match.score AS resume_match_score` and `resume_match.matched_terms AS resume_match_evidence`. Order by score descending, then `COALESCE(j.published_at, j.first_seen_at) DESC`, then id. Keep canonical URL deduplication before filtering.

- [ ] **Step 6: Run codec and SQL tests**

Run: `npx vitest run lib/job-filter-query.test.ts lib/job-search-sql.test.ts lib/pulse-mappers.test.ts`

Expected: PASS and representative `EXPLAIN QUERY PLAN` output uses the match/profile indexes.

- [ ] **Step 7: Write the failing Jobs UI test**

```tsx
it("activates My Resume Match and explains the score", async () => {
  render(<JobsScreen initialQuery="" initialSearchParams="" />);
  await user.click(screen.getByRole("button", { name: "My Resume Match" }));
  expect(window.location.search).toContain("resumeMatch=chanyoung-resume");
  expect(window.location.search).toContain("region=us");
  expect(screen.getByText("92% Match")).toBeInTheDocument();
  expect(screen.getByText("Python")).toBeInTheDocument();
});
```

- [ ] **Step 8: Implement the preset and evidence UI**

The preset patch is literal:

```ts
{
  resumeMatchProfile: "chanyoung-resume",
  regions: ["us"],
  programTypes: ["internship", "coop"],
  recruitingYears: [],
  page: 1,
}
```

Render score only when non-null. Add `Why this matches` to the detail drawer using mapped evidence labels. Keep existing posting timing and region badges.

- [ ] **Step 9: Run Jobs UI tests**

Run: `npx vitest run features/jobs/jobs-screen.test.tsx features/jobs/job-detail-drawer.test.tsx`

Expected: PASS on desktop and mobile result renderers.

- [ ] **Step 10: Commit search and UI**

```bash
git add lib/domain.ts lib/pulse-mappers.ts lib/job-filter-query.ts lib/job-filter-query.test.ts lib/job-search-sql.ts lib/job-search-sql.test.ts features/jobs/job-filter-panel.tsx features/jobs/jobs-screen.tsx features/jobs/jobs-screen.test.tsx features/jobs/job-detail-drawer.tsx features/jobs/job-detail-drawer.test.tsx features/jobs/active-filter-chips.tsx app/globals.css
git commit -m "feat: add personal resume match filter"
```

---

### Task 5: Build deterministic Gmail messages and the Gmail API client

**Files:**
- Create: `lib/gmail-message.ts`
- Create: `lib/gmail-message.test.ts`
- Create: `lib/gmail-client.ts`
- Create: `lib/gmail-client.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `buildGmailRawMessage(input: GmailMessageInput): string`.
- Produces: `sendGmailMessage(credentials, input, fetcher?): Promise<{ messageId: string }>`.
- Throws: `GmailDeliveryError` with `kind: "auth" | "retryable" | "permanent"` and a sanitized message.

- [ ] **Step 1: Write a failing MIME test**

```ts
it("builds a safe multipart digest with official links and no resume PII", () => {
  const raw = decodeBase64Url(buildGmailRawMessage({
    from: "kimchany@usc.edu",
    to: "lupeter@usc.edu",
    subject: "[Job Pulse] New resume matches: 1",
    jobs: [{
      company: "Acme",
      title: "Machine Learning Intern",
      location: "Los Angeles, CA",
      timing: "Posted Aug 10, 2026",
      score: 92,
      reasons: ["Machine Learning", "Python"],
      officialUrl: "https://jobs.example/apply?id=1&source=pulse",
    }],
    siteUrl: "https://job-pulse-realtime.cksdud985.chatgpt.site/jobs?resumeMatch=chanyoung-resume",
  }));
  expect(raw).toContain("Content-Type: multipart/alternative");
  expect(raw).toContain("Machine Learning Intern");
  expect(raw).not.toContain("(213) 598-7426");
});
```

- [ ] **Step 2: Run MIME tests and verify the builder is missing**

Run: `npx vitest run lib/gmail-message.test.ts`

Expected: FAIL because `buildGmailRawMessage` does not exist.

- [ ] **Step 3: Implement MIME construction**

```ts
export interface GmailMessageInput {
  from: string;
  to: string;
  subject: string;
  jobs: DigestJob[];
  siteUrl: string;
  testOnly?: boolean;
}

export function buildGmailRawMessage(input: GmailMessageInput): string {
  const boundary = "job-pulse-resume-v1";
  const headers = [
    `From: Job Pulse <${input.from}>`,
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const mime = [...headers, "", `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "",
    renderPlainText(input), `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "",
    renderHtml(input), `--${boundary}--`, ""].join("\r\n");
  return base64Url(new TextEncoder().encode(mime));
}
```

Escape HTML text and URLs, reject non-HTTP(S) official links, strip CR/LF from header values, and cap reasons at four.

- [ ] **Step 4: Write failing Gmail HTTP contract tests**

```ts
it("exchanges the refresh token and sends as user me", async () => {
  const fetcher = sequenceFetch(
    jsonResponse({ access_token: "access", expires_in: 3600 }),
    jsonResponse({ id: "gmail-message-1" }),
  );
  await expect(sendGmailMessage(credentials, message, fetcher))
    .resolves.toEqual({ messageId: "gmail-message-1" });
  expect(fetcher.urls).toEqual([
    "https://oauth2.googleapis.com/token",
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
  ]);
});
```

- [ ] **Step 5: Implement token exchange and send with classified errors**

```ts
export class GmailDeliveryError extends Error {
  constructor(
    readonly kind: "auth" | "retryable" | "permanent",
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}
```

Use form-encoded refresh-token exchange, a 20-second abort timeout, Bearer authorization, and `{ raw }` JSON send body. Map `invalid_grant` and 401 to auth, 408/429/5xx/network to retryable, and other 4xx to permanent. Store at most 500 sanitized error characters.

- [ ] **Step 6: Run Gmail tests**

Run: `npx vitest run lib/gmail-message.test.ts lib/gmail-client.test.ts`

Expected: PASS for success, auth, 429, 5xx, malformed JSON, header injection, and unsafe URL cases.

- [ ] **Step 7: Document empty environment keys and commit**

```dotenv
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_SENDER=
```

```bash
git add lib/gmail-message.ts lib/gmail-message.test.ts lib/gmail-client.ts lib/gmail-client.test.ts .env.example
git commit -m "feat: add gmail digest transport"
```

---

### Task 6: Plan, reserve, lease, and send two-recipient digests

**Files:**
- Create: `lib/resume-alert-store.ts`
- Create: `lib/resume-alert-store.test.ts`
- Create: `lib/resume-alert-service.ts`
- Create: `lib/resume-alert-service.test.ts`

**Interfaces:**
- Produces: `getResumeAlertStatus(database, profileId, configured): Promise<ResumeAlertStatus>`.
- Produces: `processDueResumeAlerts(database, config, now, fetcher?): Promise<ResumeDispatchResult>`.
- Produces: `sendResumeTestEmail(database, config, recipients, fetcher?): Promise<TestEmailResult>`.
- Consumes: Gmail client, profile recipients, active notification-eligible matches, and recipient idempotency constraints.

- [ ] **Step 1: Write failing idempotency and partial-failure tests**

```ts
it("reserves one item per recipient and never duplicates a sent pair", async () => {
  const db = alertDatabaseWithMatches(2);
  const first = await planResumeDigests(db, "chanyoung-resume", NOW, 25);
  const second = await planResumeDigests(db, "chanyoung-resume", NOW, 25);
  expect(first).toHaveLength(2);
  expect(second).toHaveLength(0);
  expect(countNotificationItems(db)).toBe(4);
});

it("keeps only the failed recipient retryable", async () => {
  const transport = recipientTransport({
    "kimchany@usc.edu": "sent",
    "lupeter@usc.edu": "retryable",
  });
  const result = await processDueResumeAlerts(db, config, NOW, transport);
  expect(result).toMatchObject({ sent: 1, retryable: 1 });
  expect(statusFor(db, "kimchany@usc.edu")).toBe("sent");
  expect(statusFor(db, "lupeter@usc.edu")).toBe("retryable");
});
```

- [ ] **Step 2: Run alert tests and verify planner/service are missing**

Run: `npx vitest run lib/resume-alert-store.test.ts lib/resume-alert-service.test.ts`

Expected: FAIL because the store and service exports do not exist.

- [ ] **Step 3: Implement atomic digest reservation**

```ts
export async function planResumeDigests(
  database: D1Database,
  profileId: string,
  now: string,
  pageSize = 25,
): Promise<PlannedNotification[]> {
  const lease = await claimDispatchLease(database, profileId, now);
  if (!lease) return [];
  try {
    return await reserveRecipientDigests(database, profileId, now, Math.min(25, Math.max(1, pageSize)));
  } finally {
    await releaseDispatchLease(database, profileId, lease.owner);
  }
}
```

Select only active, notification-eligible current-generation matches without an existing `notification_items(job_match_id, recipient)` row. Create one notification per recipient and deterministic 25-item page, then insert all items in a D1 batch. If an item unique constraint loses a race, delete an empty notification envelope.

- [ ] **Step 4: Implement notification claim and retry transitions**

Use atomic `UPDATE ... RETURNING` from `queued` or due `retryable` to `sending` with a five-minute lease. Backoff is 5, 15, 60, then 360 minutes. Auth errors transition to `auth_blocked` and set profile Gmail state blocked. Success marks notification sent, sets provider id, updates profile `last_digest_at`, and sets legacy `job_matches.notified_at` only after every enabled recipient has a sent item for that match.

- [ ] **Step 5: Implement the orchestration service**

```ts
export interface GmailRuntimeConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  sender: string;
  siteUrl: string;
}

export async function processDueResumeAlerts(
  database: D1Database,
  config: GmailRuntimeConfig | null,
  now: Date,
  fetcher: typeof fetch = fetch,
): Promise<ResumeDispatchResult> {
  if (!config) return markUnconfigured(database);
  await planResumeDigests(database, "chanyoung-resume", now.toISOString(), 25);
  const claimed = await claimDueNotifications(database, now.toISOString(), 4);
  return deliverClaimed(database, config, claimed, fetcher);
}
```

Cap one invocation at four messages, enough for two recipients and two 25-job parts while preserving request bounds.

- [ ] **Step 6: Run concurrency and retry tests**

Run: `npx vitest run lib/resume-alert-store.test.ts lib/resume-alert-service.test.ts`

Expected: PASS for two planners, two claimers, partial failure, auth block, expired lease, and no-match no-send.

- [ ] **Step 7: Commit the delivery pipeline**

```bash
git add lib/resume-alert-store.ts lib/resume-alert-store.test.ts lib/resume-alert-service.ts lib/resume-alert-service.test.ts
git commit -m "feat: queue and deliver resume digests"
```

---

### Task 7: Expose the API, integrate crawl dispatch, and add the Alerts card

**Files:**
- Modify: `lib/domain.ts`
- Modify: `lib/repository.ts`
- Modify: `lib/api-repository.ts`
- Modify: `lib/api-repository.test.ts`
- Modify: `lib/fixture-repository.ts`
- Modify: `app/api/pulse/route.ts`
- Modify: `worker/crawler.ts`
- Create: `features/alerts/resume-alert-card.tsx`
- Create: `features/alerts/resume-alert-card.test.tsx`
- Modify: `features/alerts/alerts-screen.tsx`
- Modify: `app/globals.css`
- Modify: `worker-configuration.d.ts`

**Interfaces:**
- Produces API resource: `GET /api/pulse?resource=resumeAlert`.
- Produces actions: `backfillResumeMatches`, `setResumeAlertEnabled`, `sendResumeTestEmail`, and `retryResumeAlert`.
- Adds bounded due-dispatch result to crawl response without changing existing crawl count meanings.

- [ ] **Step 1: Write failing repository request tests**

```ts
it("requests resume status and test delivery through pulse actions", async () => {
  const repository = createApiRepository();
  await repository.getResumeAlertStatus();
  await repository.sendResumeTestEmail();
  expect(fetchMock.calls[0][0]).toContain("resource=resumeAlert");
  expect(JSON.parse(String(fetchMock.calls[1][1]?.body))).toEqual({
    action: "sendResumeTestEmail",
  });
});
```

- [ ] **Step 2: Run repository tests and verify methods are absent**

Run: `npx vitest run lib/api-repository.test.ts`

Expected: FAIL because resume alert repository methods do not exist.

- [ ] **Step 3: Add domain and repository contracts**

```ts
export interface ResumeAlertStatus {
  profileId: "chanyoung-resume";
  enabled: boolean;
  gmailState: "unconfigured" | "connected" | "blocked";
  sender: string;
  recipients: string[];
  queuedJobs: number;
  lastDigestAt: string | null;
  nextDigestAt: string | null;
  lastError: string | null;
}
```

Add `getResumeAlertStatus`, `setResumeAlertEnabled`, `sendResumeTestEmail`, and `retryResumeAlert` to both API and fixture repositories.

- [ ] **Step 4: Add route actions with strict validation**

Read Gmail configuration from `env` with a helper that returns null unless all four values are non-empty. The backfill action accepts an optional 200-character `afterId` and limit capped at 500. Enabling requires Gmail configuration and a non-null activation watermark; the first enable atomically sets the watermark and `next_digest_at` two hours later.

After `runDueCrawls` completes, call:

```ts
const alerts = await processDueResumeAlerts(database, gmailRuntimeConfig(env), new Date());
return json({ ...result, alerts });
```

Do the same after the standalone scheduled worker finishes. Alert failure must be returned/logged independently and must not rewrite successful crawl counts as failed.

- [ ] **Step 5: Write the failing Alerts card test**

```tsx
it("shows both recipients and sends a connection test", async () => {
  render(<ResumeAlertCard status={connectedStatus} onToggle={toggle} onTest={sendTest} onRetry={retry} />);
  expect(screen.getByText("kimchany@usc.edu")).toBeInTheDocument();
  expect(screen.getByText("lupeter@usc.edu")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Send test email" }));
  expect(sendTest).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 6: Implement the card and Alerts integration**

Render connection, sender, recipients, last/next digest, queue count, sanitized error, toggle, test, and retry. Disable activation when Gmail is unconfigured. Use an `aria-live` result message and preserve the existing keyword-rule screen.

- [ ] **Step 7: Run API, worker, and UI tests**

Run: `npx vitest run lib/api-repository.test.ts features/alerts/resume-alert-card.test.tsx worker/crawl-store.test.ts lib/crawl-runner.test.ts`

Expected: PASS; alert send failures remain isolated from crawl source results.

- [ ] **Step 8: Regenerate Worker types and commit**

Run: `npx wrangler types`

```bash
git add lib/domain.ts lib/repository.ts lib/api-repository.ts lib/api-repository.test.ts lib/fixture-repository.ts app/api/pulse/route.ts worker/crawler.ts features/alerts/resume-alert-card.tsx features/alerts/resume-alert-card.test.tsx features/alerts/alerts-screen.tsx app/globals.css worker-configuration.d.ts
git commit -m "feat: expose resume email controls"
```

---

### Task 8: Verify locally and review the complete implementation

**Files:**
- Modify only files required by verified defects.

**Interfaces:**
- Consumes all prior tasks.
- Produces one validated source commit suitable for Sites packaging.

- [ ] **Step 1: Run focused feature tests**

Run:

```bash
npx vitest run lib/resume-match.test.ts lib/resume-match-store.test.ts lib/job-filter-query.test.ts lib/job-search-sql.test.ts lib/gmail-message.test.ts lib/gmail-client.test.ts lib/resume-alert-store.test.ts lib/resume-alert-service.test.ts features/jobs/jobs-screen.test.tsx features/jobs/job-detail-drawer.test.tsx features/alerts/resume-alert-card.test.tsx lib/api-repository.test.ts worker/crawl-store.test.ts
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 2: Run the full verification suite**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

Expected: typecheck, lint, all Vitest files, production build, and whitespace checks pass.

- [ ] **Step 3: Apply all migrations to a fresh local D1 and inspect data**

Run:

```bash
npm run db:migrate:local
npm run db:seed:local
npm run db:verify:local
```

Expected: one resume profile, two enabled recipients, no duplicate profile recipient, and zero notification items before activation.

- [ ] **Step 4: Run mutation-focused red-green confirmation**

Temporarily change the matcher threshold comparison from `>=` to `>`, run `lib/resume-match.test.ts` and observe the threshold fixture fail, then restore the code and rerun to PASS. Temporarily remove the recipient unique constraint from the local test schema, run the concurrency test and observe duplicate reservations, then restore the migration/schema and rerun to PASS.

- [ ] **Step 5: Review the exact source diff**

Run: `git diff --stat HEAD~7..HEAD`

Run: `git diff --check HEAD~7..HEAD`

Inspect all changed source, migration, environment-example, and test files. Confirm no OAuth value, resume text, phone number, message body, or generated local state appears.

- [ ] **Step 6: Commit verification-only fixes if any**

Run `git status --short`, stage only the exact implementation paths changed while correcting a verified failure, inspect them with `git diff --cached --name-only`, and commit with `git commit -m "fix: address resume alert verification"`. If no defect was found, do not create an empty commit.

---

### Task 9: Create Gmail OAuth credentials in Chrome and store Sites secrets

**Files:**
- No repository files contain credential values.
- Modify Sites production environment variables only.

**Interfaces:**
- Produces Sites secrets `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, and `GMAIL_SENDER`.
- Consumes the user's existing Chrome Google login and explicit Google consent.

- [ ] **Step 1: Open Google Cloud Console in the user's Chrome**

Use the connected Chrome session and navigate to `https://console.cloud.google.com/`. Create or select a project named `Job Pulse Realtime`. If Google requires account sign-in, organization approval, CAPTCHA, passkey, or user confirmation, stop on that screen for the user and resume after completion.

- [ ] **Step 2: Enable Gmail API**

Open APIs & Services, find Gmail API, and enable it. Verify the enabled API page identifies the selected `Job Pulse Realtime` project.

- [ ] **Step 3: Configure OAuth consent**

Configure an external personal-use OAuth app named `Job Pulse Realtime`, support email `kimchany@usc.edu`, and scope `https://www.googleapis.com/auth/gmail.send`. Add `kimchany@usc.edu` as the only test user if the console requires test users. If a USC administrator blocks the app, preserve the error screen and report the policy blocker without changing organization policy.

- [ ] **Step 4: Create the OAuth client and authorize send scope**

Create a Web application OAuth client named `Job Pulse Gmail Sender` with authorized redirect URI `https://developers.google.com/oauthplayground`. In OAuth 2.0 Playground settings, use the new client credentials, authorize only `https://www.googleapis.com/auth/gmail.send`, complete the user's consent, and exchange the code for a refresh token.

- [ ] **Step 5: Store values directly as Sites secrets**

Call Sites environment update for the existing project with:

```ts
{
  set_values: [
    { key: "GMAIL_CLIENT_ID", value: oauthClientId, is_secret: true },
    { key: "GMAIL_CLIENT_SECRET", value: oauthClientSecret, is_secret: true },
    { key: "GMAIL_REFRESH_TOKEN", value: oauthRefreshToken, is_secret: true },
    { key: "GMAIL_SENDER", value: "kimchany@usc.edu", is_secret: false },
  ],
}
```

Mark the first three values secret. Do not print, persist, copy into a shell command, or store them in Git configuration. Confirm only key names, secret flags, and environment revision in output.

---

### Task 10: Publish privately, test delivery, baseline, and activate

**Files:**
- Modify: `docs/superpowers/plans/2026-08-10-resume-match-gmail-alert-implementation.md` only to check completed boxes if desired.

**Interfaces:**
- Consumes the verified source commit and Sites environment revision.
- Produces a private live deployment, two Gmail connection-test messages, website-only baseline matches, and enabled two-hour digests.

- [ ] **Step 1: Commit the exact verified source**

Run: `git status --short` and preserve unrelated `.playwright-cli/` and `exports/`. Commit only implementation files with:

```bash
git add db/schema.ts drizzle/0046_resume_match_gmail_alerts.sql drizzle/meta/0046_snapshot.json drizzle/meta/_journal.json lib/resume-match.ts lib/resume-match.test.ts lib/resume-match-store.ts lib/resume-match-store.test.ts lib/resume-alert-store.ts lib/resume-alert-store.test.ts lib/resume-alert-service.ts lib/resume-alert-service.test.ts lib/gmail-message.ts lib/gmail-message.test.ts lib/gmail-client.ts lib/gmail-client.test.ts lib/domain.ts lib/pulse-mappers.ts lib/job-filter-query.ts lib/job-filter-query.test.ts lib/job-search-sql.ts lib/job-search-sql.test.ts lib/repository.ts lib/api-repository.ts lib/api-repository.test.ts lib/fixture-repository.ts worker/crawl-store.ts worker/crawl-store.test.ts lib/crawl-runner.ts app/api/pulse/route.ts worker/crawler.ts features/jobs/job-filter-panel.tsx features/jobs/jobs-screen.tsx features/jobs/jobs-screen.test.tsx features/jobs/job-detail-drawer.tsx features/jobs/job-detail-drawer.test.tsx features/jobs/active-filter-chips.tsx features/alerts/resume-alert-card.tsx features/alerts/resume-alert-card.test.tsx features/alerts/alerts-screen.tsx app/globals.css .env.example worker-configuration.d.ts
git commit -m "feat: deliver personal resume match alerts"
```

- [ ] **Step 2: Push and package the exact commit**

Obtain a short-lived Sites source credential, push the exact branch HEAD with a per-command HTTP authorization header, and run the Sites package helper against a fresh `mktemp -d` staging directory. Verify the archive contains `dist/server/index.js`, `dist/.openai/hosting.json`, and migration 0046.

- [ ] **Step 3: Save and privately deploy one Sites version**

Save the version with the pushed HEAD SHA and exact archive. Use private deployment because the current access policy is owner-only. Poll until `succeeded`. Do not modify site access.

- [ ] **Step 4: Verify Gmail configuration and send connection tests**

Read `GET /api/pulse?resource=resumeAlert` using the existing SIWC token. Confirm sender and both recipients without exposing secrets. Call `sendResumeTestEmail` once; verify one Gmail provider id per recipient and that test delivery created no `notification_items`.

- [ ] **Step 5: Set activation watermark before baseline backfill**

Call the enable action. Verify the response atomically reports `enabled=true`, `gmailState=connected`, a non-null production `activationWatermark`, and `nextDigestAt` exactly two hours after that watermark.

- [ ] **Step 6: Run bounded baseline backfill to completion**

Call `backfillResumeMatches` with limit 500 and keyset `afterId` until `nextCursor` is null or a 20-minute activation cap is reached. Continue remaining pages in the next bounded run if required. Verify every baseline match has `notification_eligible = 0`.

- [ ] **Step 7: Verify the private live UI**

Open:

```text
https://job-pulse-realtime.cksdud985.chatgpt.site/jobs?resumeMatch=chanyoung-resume&region=us&program=internship&program=coop
```

Confirm company, role, U.S. region, Posted/First seen timing, score, evidence chips, and `Why this matches`. Confirm the Alerts card shows Gmail connected, both recipients, no queued historical jobs, and the next two-hour digest.

- [ ] **Step 8: Verify production counts and no regression**

Check overview, source counts, existing 2027 Tech Internship filters, Motorola Solutions `R67461`, ConocoPhillips `REQ-006200`, and the resume filter total. Confirm no existing crawl/source/job count materially regressed and no historical notification item was created.

- [ ] **Step 9: Final handoff**

Report the private live URL, current resume-match count, sender and recipients, activation watermark, next digest time, connection-test success, and any genuine OAuth/admin blocker. Do not report credential values.
