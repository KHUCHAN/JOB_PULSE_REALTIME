# JOB_PULSE_REALTIME Frontend Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish a private-feeling, public-code Sites frontend that lets one owner explore fixture jobs, source health, keyword alerts, Talent registration tasks, and activity without claiming that live crawling, email, or persistence is active.

**Architecture:** Initialize the OpenAI Sites vinext starter in the existing projectless repository. Keep product state behind a typed `JobPulseRepository` interface, provide an in-memory fixture implementation through a React context, and build six focused App Router routes around that contract. Later D1 and API work replaces the repository implementation without changing page-level domain types.

**Tech Stack:** OpenAI Sites vinext starter, React, TypeScript, plain CSS with design tokens, Lucide React icons, Vitest, React Testing Library, jsdom.

## Global Constraints

- The first slice is frontend-only: no live crawling, live email, live D1 reads/writes, or automated submission.
- Every simulated mutation is labeled `Demo data` and `Crawl now` performs no network request.
- The repository is public; never add resumes, application records, confirmation screenshots, personal contact information, credentials, raw email content, or unsanitized workbook exports.
- The app has six routes: Overview, Jobs, Sources, Alerts, Talent Harness, and Activity.
- Use a deep navy navigation surface, warm off-white canvas, white data surfaces, and text-plus-color statuses.
- Use 44-pixel minimum interactive targets, visible keyboard focus, semantic labels, and responsive desktop/mobile layouts.
- Keep the bundled Sites/vinext architecture, package manager, lockfile, and `.openai/hosting.json`.
- Remove the starter preview skeleton, starter metadata, and unused `react-loading-skeleton` dependency after the product UI replaces it.
- Use exactly one generated social-preview image after the final visual direction is stable; omit `og:image` if its text is incorrect after one retry.
- Do not add D1, R2, authentication, email-provider, crawler, queue, or webhook bindings in this plan.

---

## Planned File Structure

| Path | Responsibility |
|---|---|
| `app/layout.tsx` | Product metadata, global providers, and application shell. |
| `app/page.tsx` | Overview route entry. |
| `app/jobs/page.tsx` | Jobs route entry. |
| `app/sources/page.tsx` | Sources route entry. |
| `app/alerts/page.tsx` | Alerts route entry. |
| `app/talent/page.tsx` | Talent Harness route entry. |
| `app/activity/page.tsx` | Activity route entry. |
| `app/globals.css` | Design tokens, shell, responsive layout, reusable primitives, and route styles. |
| `components/app-shell.tsx` | Sidebar, mobile navigation, top bar, Demo data badge, and main content frame. |
| `components/fixture-provider.tsx` | One in-memory repository instance, revision tracking, and mutation refresh. |
| `components/ui/status-badge.tsx` | Text-plus-color operational status. |
| `components/ui/metric-card.tsx` | Overview KPI card. |
| `components/ui/empty-state.tsx` | Shared empty state. |
| `components/ui/error-state.tsx` | Shared retryable error state. |
| `components/ui/loading-state.tsx` | Shared accessible loading state. |
| `features/overview/overview-screen.tsx` | Overview composition and fixture Crawl now behavior. |
| `features/jobs/jobs-screen.tsx` | Job filtering, sorting, and state transitions. |
| `features/jobs/job-detail-drawer.tsx` | Accessible job detail drawer and official-link action. |
| `features/sources/sources-screen.tsx` | Source health filters and monitoring table. |
| `features/alerts/alerts-screen.tsx` | Keyword creation, toggles, exclusions, and delivery summaries. |
| `features/talent/talent-screen.tsx` | Talent queue, blocker states, and assisted-flow actions. |
| `features/activity/activity-screen.tsx` | Event filtering and expandable technical details. |
| `lib/domain.ts` | Shared domain types and filter inputs. |
| `lib/repository.ts` | `JobPulseRepository` interface. |
| `lib/fixtures.ts` | Sanitized fixture records only. |
| `lib/fixture-repository.ts` | In-memory repository implementation. |
| `lib/use-repository-query.ts` | Async repository query hook with loading/error state. |
| `lib/format.ts` | Date, count, and match-reason formatting helpers. |
| `test/setup.ts` | DOM matcher and test cleanup setup. |
| `public/og.png` | One validated product-specific social preview. |

---

### Task 1: Bootstrap Sites and Lock the Domain Contract

**Files:**
- Create through initializer: `package.json`, `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `.openai/hosting.json`
- Create: `vitest.config.ts`
- Create: `test/setup.ts`
- Create: `lib/domain.ts`
- Create: `lib/repository.ts`
- Create: `lib/fixtures.ts`
- Create: `lib/fixture-repository.ts`
- Create: `lib/fixture-repository.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: none.
- Produces: `JobPulseRepository`, all domain types, `createFixtureRepository()`, and the test/build foundation used by every later task.

- [ ] **Step 1: Initialize the Sites starter in the repository root**

Run from `/Users/gimchan-yeong/Desktop/Job posting/JOB_PULSE_REALTIME`:

```bash
bash /Users/gimchan-yeong/.codex/plugins/cache/openai-bundled/sites/0.1.34/scripts/init-site.sh "$PWD"
```

Retain the installation session until it completes. Start `npm run dev` in a separate retained session, preserve the printed Local URL, and call `open_in_codex` exactly once.

- [ ] **Step 2: Add the test and icon dependencies**

```bash
npm install lucide-react
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Add these scripts without changing the starter build scripts:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 3: Configure Vitest and the shared setup**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
  },
});
```

Create `test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
```

- [ ] **Step 4: Write the failing repository test**

Create `lib/fixture-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFixtureRepository } from "./fixture-repository";

describe("fixture repository", () => {
  it("filters jobs by query and match status", async () => {
    const repository = createFixtureRepository();
    const jobs = await repository.listJobs({ query: "fraud", status: "new" });

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((job) => `${job.title} ${job.summary}`.toLowerCase().includes("fraud"))).toBe(true);
    expect(jobs.every((job) => job.status === "new")).toBe(true);
  });

  it("creates a demo crawl event without a network result", async () => {
    const repository = createFixtureRepository();
    const event = await repository.simulateCrawl();

    expect(event.kind).toBe("crawl.demo");
    expect(event.summary).toContain("Demo data");
  });
});
```

- [ ] **Step 5: Run the focused test and verify failure**

```bash
npm test -- lib/fixture-repository.test.ts
```

Expected: FAIL because `createFixtureRepository` and the domain contract do not exist.

- [ ] **Step 6: Define the exact domain contract**

Create `lib/domain.ts` with these exported types:

```ts
export type JobState = "new" | "saved" | "hidden" | "applied";
export type WorkArrangement = "onsite" | "hybrid" | "remote";
export type SourceHealth = "healthy" | "changed" | "blocked" | "failed" | "inactive";
export type TalentState = "ready" | "in_progress" | "blocked" | "completed";
export type ActivityKind =
  | "crawl.demo"
  | "source.changed"
  | "source.failed"
  | "job.created"
  | "job.updated"
  | "job.closed"
  | "match.created"
  | "email.sent"
  | "email.failed"
  | "talent.updated";

export interface JobPosting {
  id: string;
  sourceId: string;
  company: string;
  title: string;
  location: string;
  arrangement: WorkArrangement;
  summary: string;
  officialUrl: string;
  matchedTerms: string[];
  matchScore: number;
  firstSeenAt: string;
  lastConfirmedAt: string;
  status: JobState;
}

export interface JobFilters {
  query: string;
  status: "all" | JobState;
  arrangement: "all" | WorkArrangement;
  location: string;
}

export interface SourceRecord {
  id: string;
  company: string;
  postingUrl: string | null;
  talentUrl: string | null;
  adapter: "greenhouse" | "lever" | "workday" | "icims" | "custom";
  health: SourceHealth;
  httpStatus: number | null;
  currentJobs: number;
  lastCheckedAt: string;
  lastChangedAt: string | null;
  nextRunAt: string;
}

export interface KeywordRule {
  id: string;
  name: string;
  includeTerms: string[];
  excludeTerms: string[];
  locations: string[];
  enabled: boolean;
  mode: "six_hour" | "daily_digest";
  lastSentAt: string | null;
}

export interface TalentTarget {
  id: string;
  company: string;
  ats: string;
  talentUrl: string;
  resumeUpload: "available" | "job_only" | "unknown";
  jobAlerts: "available" | "unknown";
  state: TalentState;
  blocker: string | null;
  lastAttemptAt: string | null;
}

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  severity: "info" | "success" | "warning" | "error";
  summary: string;
  occurredAt: string;
  technicalId: string;
  details: string;
}

export interface OverviewSnapshot {
  newMatches: number;
  activeSources: number;
  sourceErrors: number;
  unsentAlerts: number;
  openTalentTasks: number;
  latestJobs: JobPosting[];
  recentActivity: ActivityEvent[];
}

export interface ActivityFilters {
  severity: "all" | ActivityEvent["severity"];
  kind: "all" | ActivityKind;
}

export interface CreateKeywordInput {
  name: string;
  includeTerms: string[];
  excludeTerms: string[];
  locations: string[];
  mode: KeywordRule["mode"];
}
```

- [ ] **Step 7: Define and implement the repository**

Create `lib/repository.ts`:

```ts
import type {
  ActivityEvent, ActivityFilters, CreateKeywordInput, JobFilters, JobPosting,
  JobState, KeywordRule, OverviewSnapshot, SourceRecord, TalentState, TalentTarget,
} from "./domain";

export interface JobPulseRepository {
  getOverview(): Promise<OverviewSnapshot>;
  listJobs(filters?: Partial<JobFilters>): Promise<JobPosting[]>;
  getJob(jobId: string): Promise<JobPosting | null>;
  updateJobState(jobId: string, state: JobState): Promise<JobPosting>;
  listSources(health?: SourceRecord["health"] | "all"): Promise<SourceRecord[]>;
  listKeywords(): Promise<KeywordRule[]>;
  createKeyword(input: CreateKeywordInput): Promise<KeywordRule>;
  setKeywordEnabled(keywordId: string, enabled: boolean): Promise<KeywordRule>;
  listTalentTargets(state?: TalentState | "all"): Promise<TalentTarget[]>;
  updateTalentState(targetId: string, state: TalentState, blocker?: string | null): Promise<TalentTarget>;
  listActivity(filters?: Partial<ActivityFilters>): Promise<ActivityEvent[]>;
  simulateCrawl(): Promise<ActivityEvent>;
}
```

Create `lib/fixtures.ts` with exactly 12 sanitized `JobPosting` records, 10 `SourceRecord` records, 4 `KeywordRule` records, 8 `TalentTarget` records, and 12 `ActivityEvent` records. Use only public company/ATS URLs, no contact data, ensure at least two new jobs contain `fraud` in the title or summary, and prefix every activity `technicalId` with `event-`.

Create `lib/fixture-repository.ts` as an in-memory implementation. Merge missing filters with:

```ts
const defaultFilters: JobFilters = {
  query: "",
  status: "all",
  arrangement: "all",
  location: "",
};
```

All mutations update the in-memory arrays. `simulateCrawl()` prepends an event whose summary is exactly `Demo data · simulated crawl completed; no network request was made.`

- [ ] **Step 8: Run tests and build**

```bash
npm test -- lib/fixture-repository.test.ts
npm run build
```

Expected: both commands PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add package.json package-lock.json vitest.config.ts test lib app .openai
git commit -m "feat: bootstrap Sites frontend data contract"
```

---

### Task 2: Build the Application Shell and Fixture Provider

**Files:**
- Create: `components/fixture-provider.tsx`
- Create: `components/app-shell.tsx`
- Create: `components/app-shell.test.tsx`
- Create: `components/ui/status-badge.tsx`
- Create: `components/ui/metric-card.tsx`
- Create: `components/ui/empty-state.tsx`
- Create: `components/ui/error-state.tsx`
- Create: `components/ui/loading-state.tsx`
- Create: `lib/use-repository-query.ts`
- Create: `lib/format.ts`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `JobPulseRepository` and `createFixtureRepository()` from Task 1.
- Produces: `useJobPulse()` returning `{ repository, revision, demoMode, mutate }`, reusable UI primitives, and the shared shell used by all routes.

- [ ] **Step 1: Write the failing shell test**

```tsx
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";
import { FixtureProvider } from "./fixture-provider";

describe("AppShell", () => {
  it("shows every route and runs a demo-only crawl", async () => {
    const user = userEvent.setup();
    render(<FixtureProvider><AppShell><div>Route body</div></AppShell></FixtureProvider>);
    for (const name of ["Overview", "Jobs", "Sources", "Alerts", "Talent Harness", "Activity"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.getByText("Demo data")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Crawl now" }));
    expect(await screen.findByText(/simulated crawl completed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the shell test and verify failure**

```bash
npm test -- components/app-shell.test.tsx
```

Expected: FAIL because the provider and shell do not exist.

- [ ] **Step 3: Implement the provider contract**

`components/fixture-provider.tsx` must export:

```ts
export interface JobPulseContextValue {
  repository: JobPulseRepository;
  revision: number;
  demoMode: true;
  mutate<T>(operation: () => Promise<T>): Promise<T>;
}

export function FixtureProvider({ children }: { children: React.ReactNode }): React.ReactElement;
export function useJobPulse(): JobPulseContextValue;
```

Construct `createFixtureRepository()` exactly once with `useRef`. `mutate` awaits the operation, increments `revision`, and returns its result.

Create `lib/use-repository-query.ts` with:

```ts
export function useRepositoryQuery<T>(
  loader: () => Promise<T>,
  dependencies: readonly unknown[],
): { data: T | null; loading: boolean; error: Error | null; retry(): void };
```

- [ ] **Step 4: Implement the shell and primitives**

Use Lucide icons and this exact navigation order:

```ts
const navigation = [
  { href: "/", label: "Overview" },
  { href: "/jobs", label: "Jobs" },
  { href: "/sources", label: "Sources" },
  { href: "/alerts", label: "Alerts" },
  { href: "/talent", label: "Talent Harness" },
  { href: "/activity", label: "Activity" },
];
```

`StatusBadge` must render its normalized status on `data-status`, include visible status text, and never communicate state through color alone.

The top bar includes the product title, global keyword input, demo-only `Crawl now` button, health text, and `Demo data` badge. Wire `Crawl now` to `mutate(() => repository.simulateCrawl())` and show the returned summary in an `aria-live="polite"` banner. The global keyword input is a GET form with `action="/jobs"`, `name="q"`, and an accessible label so a submitted value becomes `/jobs?q=<encoded value>`. The mobile menu must be a real button with `aria-expanded` and a minimum 44-pixel hit area.

Set CSS tokens in `app/globals.css`:

```css
:root {
  --navy-950: #071426;
  --navy-900: #0b1f36;
  --canvas: #f5f2ea;
  --surface: #ffffff;
  --ink: #172033;
  --muted: #657086;
  --line: #dce2ea;
  --success: #19734b;
  --warning: #a65d00;
  --danger: #b42318;
  --info: #1d5ea8;
  --radius-lg: 18px;
}
```

- [ ] **Step 5: Replace starter metadata and wrap all pages**

`app/layout.tsx` must set title `Job Pulse Realtime`, description `Personal job monitoring, alerts, source health, and Talent workflow console.`, import `globals.css`, and render:

```tsx
<FixtureProvider>
  <AppShell>{children}</AppShell>
</FixtureProvider>
```

Remove `app/_sites-preview`, its imports, the `codex-preview` metadata marker, and `react-loading-skeleton` if no remaining import uses it. Refresh the lockfile.

- [ ] **Step 6: Run test and build**

```bash
npm test -- components/app-shell.test.tsx
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add app components lib package.json package-lock.json
git commit -m "feat: add Job Pulse application shell"
```

---

### Task 3: Implement the Overview Route

**Files:**
- Create: `features/overview/overview-screen.tsx`
- Create: `features/overview/overview-screen.test.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `useJobPulse()`, `useRepositoryQuery()`, and `getOverview()`.
- Produces: the fully interactive Overview route; the shared shell owns demo crawl execution.

- [ ] **Step 1: Write the failing Overview test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FixtureProvider } from "../../components/fixture-provider";
import { OverviewScreen } from "./overview-screen";

describe("OverviewScreen", () => {
  it("renders operational metrics and recent work", async () => {
    render(<FixtureProvider><OverviewScreen /></FixtureProvider>);

    expect(await screen.findByText("New matching jobs")).toBeInTheDocument();
    expect(screen.getByText("Latest matching jobs")).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- features/overview/overview-screen.test.tsx
```

Expected: FAIL because `OverviewScreen` does not exist.

- [ ] **Step 3: Implement Overview**

Render five metric cards with labels `New matching jobs`, `Active sources`, `Source errors`, `Unsent alerts`, and `Open Talent tasks`. Add sections headed `Latest matching jobs`, `Source health`, `Next Talent tasks`, and `Recent activity`. Demo crawl behavior remains in the shared shell so every route uses one consistent action.

Use `LoadingState`, `ErrorState`, and `EmptyState` for query states; never display a fake success before the mutation resolves.

- [ ] **Step 4: Run test and build**

```bash
npm test -- features/overview/overview-screen.test.tsx
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add app/page.tsx app/globals.css features/overview
git commit -m "feat: add operational overview dashboard"
```

---

### Task 4: Implement Jobs Filtering and Detail Drawer

**Files:**
- Create: `features/jobs/jobs-screen.tsx`
- Create: `features/jobs/job-detail-drawer.tsx`
- Create: `features/jobs/jobs-screen.test.tsx`
- Create: `app/jobs/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `listJobs()`, `updateJobState()`, `JobFilters`, and `JobPosting`.
- Produces: `JobsScreen({ initialQuery?: string })`, a Jobs route that accepts the shell's `q` search parameter, query/status/arrangement/location filters, and an accessible detail drawer.

- [ ] **Step 1: Write the failing Jobs test**

```tsx
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FixtureProvider } from "../../components/fixture-provider";
import { JobsScreen } from "./jobs-screen";

describe("JobsScreen", () => {
  it("filters jobs and opens match details", async () => {
    const user = userEvent.setup();
    render(<FixtureProvider><JobsScreen initialQuery="" /></FixtureProvider>);
    await screen.findByRole("heading", { name: "Jobs" });

    await user.type(screen.getByRole("searchbox", { name: "Search jobs" }), "fraud");
    const rows = await screen.findAllByRole("button", { name: /View .* details/ });
    expect(rows.length).toBeGreaterThan(0);
    await user.click(rows[0]);
    expect(screen.getByRole("dialog", { name: "Job details" })).toBeInTheDocument();
    expect(screen.getByText("Why it matched")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- features/jobs/jobs-screen.test.tsx
```

Expected: FAIL because the Jobs route does not exist.

- [ ] **Step 3: Implement Jobs and the drawer**

Sort by `firstSeenAt` descending, then `matchScore` descending, then company. Desktop uses a table; the same records become cards below 760px. Each row/card exposes a `View <title> details` button.

Export `JobsScreen({ initialQuery = "" }: { initialQuery?: string })`. In `app/jobs/page.tsx`, read `searchParams.q`, normalize arrays to the first value, and pass the string to `initialQuery`. This makes the global shell search form functional without client-side routing state.

The drawer must use `role="dialog"`, `aria-modal="true"`, an explicit close button, Escape-key closing, and focus return to the triggering button. It shows matched terms, lifecycle timestamps, official URL, and `Save`, `Hide`, and `Mark applied` actions wired through `updateJobState()`.

- [ ] **Step 4: Run test and build**

```bash
npm test -- features/jobs/jobs-screen.test.tsx
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add app/jobs features/jobs app/globals.css
git commit -m "feat: add searchable jobs workspace"
```

---

### Task 5: Implement Sources and Activity Routes

**Files:**
- Create: `features/sources/sources-screen.tsx`
- Create: `features/sources/sources-screen.test.tsx`
- Create: `features/activity/activity-screen.tsx`
- Create: `features/activity/activity-screen.test.tsx`
- Create: `app/sources/page.tsx`
- Create: `app/activity/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `listSources()` and `listActivity()`.
- Produces: source-health operations table and filterable event history.

- [ ] **Step 1: Write the failing source-health test**

```tsx
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FixtureProvider } from "../../components/fixture-provider";
import { SourcesScreen } from "./sources-screen";

it("filters blocked sources", async () => {
  const user = userEvent.setup();
  render(<FixtureProvider><SourcesScreen /></FixtureProvider>);
  await user.selectOptions(screen.getByLabelText("Source health"), "blocked");
  const badges = await screen.findAllByText("Blocked");
  expect(badges.length).toBeGreaterThan(0);
  expect(screen.queryByText("Healthy", { selector: "[data-status]" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Write the failing activity test**

```tsx
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { FixtureProvider } from "../../components/fixture-provider";
import { ActivityScreen } from "./activity-screen";

it("reveals technical details on demand", async () => {
  const user = userEvent.setup();
  render(<FixtureProvider><ActivityScreen /></FixtureProvider>);
  const button = (await screen.findAllByRole("button", { name: "Show technical details" }))[0];
  await user.click(button);
  expect(screen.getByText(/event-/)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run both tests and verify failure**

```bash
npm test -- features/sources/sources-screen.test.tsx features/activity/activity-screen.test.tsx
```

Expected: FAIL because both screens are missing.

- [ ] **Step 4: Implement Sources**

Render company, adapter, HTTP status, extraction health, job count, last checked, last changed, and next run. Provide `all`, `healthy`, `changed`, `blocked`, `failed`, and `inactive` filtering. Display null HTTP status as `No active portal`, not `0`.

- [ ] **Step 5: Implement Activity**

Render newest events first with severity and event-kind filters. Each item uses a native `<details>` element or an equivalent button exposing `technicalId` and `details`; the collapsed view remains human-readable.

- [ ] **Step 6: Run tests and build**

```bash
npm test -- features/sources/sources-screen.test.tsx features/activity/activity-screen.test.tsx
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add app/sources app/activity features/sources features/activity app/globals.css
git commit -m "feat: add source health and activity views"
```

---

### Task 6: Implement Keyword Alerts

**Files:**
- Create: `features/alerts/alerts-screen.tsx`
- Create: `features/alerts/alerts-screen.test.tsx`
- Create: `app/alerts/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `listKeywords()`, `createKeyword()`, and `setKeywordEnabled()`.
- Produces: personal keyword management with six-hour/daily display modes and explicit demo-state feedback.

- [ ] **Step 1: Write the failing Alerts test**

```tsx
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { FixtureProvider } from "../../components/fixture-provider";
import { AlertsScreen } from "./alerts-screen";

it("adds a keyword rule in demo mode", async () => {
  const user = userEvent.setup();
  render(<FixtureProvider><AlertsScreen /></FixtureProvider>);
  await user.type(screen.getByLabelText("Rule name"), "Graph ML");
  await user.type(screen.getByLabelText("Include terms"), "graph neural network, GNN");
  await user.click(screen.getByRole("button", { name: "Add keyword rule" }));
  expect(await screen.findByText("Graph ML")).toBeInTheDocument();
  expect(screen.getByText(/Demo data.*not persisted/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- features/alerts/alerts-screen.test.tsx
```

Expected: FAIL because `AlertsScreen` is missing.

- [ ] **Step 3: Implement keyword creation and toggles**

Split include/exclude terms on commas, trim whitespace, remove empty values, and require at least one include term. Modes are labeled `Every 6 hours` and `Daily digest`. A successful mutation shows `Demo data · changes are stored only for this preview and are not persisted.` in an `aria-live="polite"` region.

Display the email destination as `Configured during backend setup`; do not put a real email address in fixtures or source code.

- [ ] **Step 4: Run test and build**

```bash
npm test -- features/alerts/alerts-screen.test.tsx
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add app/alerts features/alerts app/globals.css
git commit -m "feat: add demo keyword alert management"
```

---

### Task 7: Implement the Talent Harness Queue

**Files:**
- Create: `features/talent/talent-screen.tsx`
- Create: `features/talent/talent-screen.test.tsx`
- Create: `app/talent/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `listTalentTargets()` and `updateTalentState()`.
- Produces: an assisted registration queue that clearly stops at restricted user gates.

- [ ] **Step 1: Write the failing Talent test**

```tsx
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { FixtureProvider } from "../../components/fixture-provider";
import { TalentScreen } from "./talent-screen";

it("marks a target blocked with a visible gate reason", async () => {
  const user = userEvent.setup();
  render(<FixtureProvider><TalentScreen /></FixtureProvider>);
  const blockButtons = await screen.findAllByRole("button", { name: /Mark .* blocked/ });
  await user.click(blockButtons[0]);
  await user.selectOptions(screen.getByLabelText("Blocker reason"), "captcha");
  await user.click(screen.getByRole("button", { name: "Save blocker" }));
  expect(await screen.findByText("CAPTCHA — user action required")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- features/talent/talent-screen.test.tsx
```

Expected: FAIL because the Talent screen is missing.

- [ ] **Step 3: Implement the assisted queue**

Provide state filtering and render company, ATS, resume-upload capability, Job Alert capability, state, blocker, and last attempt. `Open official Talent page` uses `target="_blank"` plus `rel="noreferrer"`. State actions are `Start assisted flow`, `Mark completed`, and `Mark blocked`.

The blocker selector has exact options:

```ts
const blockerOptions = {
  captcha: "CAPTCHA — user action required",
  sms: "SMS verification — user action required",
  custom_question: "Custom employer question — user answer required",
  final_submit: "Final submission — user approval required",
};
```

Never include a button labeled `Bypass`, `Auto-submit`, or `Solve CAPTCHA`.

- [ ] **Step 4: Run test and build**

```bash
npm test -- features/talent/talent-screen.test.tsx
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```bash
git add app/talent features/talent app/globals.css
git commit -m "feat: add assisted Talent registration queue"
```

---

### Task 8: Finish Responsive, Accessibility, and State Coverage

**Files:**
- Create: `components/app-quality.test.tsx`
- Modify: `app/globals.css`
- Modify: route feature files only where the quality test exposes a defect.

**Interfaces:**
- Consumes: every frontend route built in Tasks 2–7.
- Produces: a coherent responsive and keyboard-accessible frontend with explicit loading, empty, and error behavior.

- [ ] **Step 1: Write the cross-route quality test**

```tsx
import { render, screen } from "@testing-library/react";
import { FixtureProvider } from "./fixture-provider";
import { JobsScreen } from "../features/jobs/jobs-screen";
import { SourcesScreen } from "../features/sources/sources-screen";

it("provides labeled controls and visible demo boundaries", async () => {
  const { rerender } = render(<FixtureProvider><JobsScreen /></FixtureProvider>);
  expect(await screen.findByRole("searchbox", { name: "Search jobs" })).toBeInTheDocument();
  expect(screen.getByLabelText("Job status")).toBeInTheDocument();
  expect(screen.getByText("Demo data")).toBeInTheDocument();

  rerender(<FixtureProvider><SourcesScreen /></FixtureProvider>);
  expect(await screen.findByLabelText("Source health")).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "Monitored sources" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run all tests and verify any failures**

```bash
npm test
```

Expected: the new test initially exposes any missing labels, Demo data badges, or table names.

- [ ] **Step 3: Complete global quality styles**

Ensure all buttons and links use `min-height: 44px`, `:focus-visible` has a 3px contrasting outline, tables have sticky headers, and breakpoints at 980px and 760px collapse the sidebar and data tables without horizontal page overflow. Respect reduced motion:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 4: Run the full test and build suite**

```bash
npm test
npm run build
```

Expected: PASS with no test failures or compilation errors.

- [ ] **Step 5: Commit Task 8**

```bash
git add app components features
git commit -m "test: harden frontend accessibility and states"
```

---

### Task 9: Add the Product Social Preview and Publish

**Files:**
- Create: `public/og.png`
- Modify: `app/layout.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: the stable visual system and copy from Tasks 2–8.
- Produces: final metadata, passing production build, GitHub update, and a deployed Sites URL.

- [ ] **Step 1: Freeze and generate one social-preview brief**

Use one `imagegen` request with this brief:

```text
Create a 1200×630 landscape social preview for “Job Pulse Realtime”. Use a deep navy background, warm off-white data surfaces, green/amber/blue operational status accents, and crisp editorial dashboard typography. Include exactly these words: “Job Pulse Realtime” and “Jobs · Sources · Alerts · Talent”. Show a refined abstract monitoring console motif, not a screenshot, no logos, no invented metrics, no additional text.
```

Inspect the result. Retry once only if required text is wrong or unreadable. If the second result is still unusable, omit `og:image` and continue.

- [ ] **Step 2: Wire host-derived metadata**

When `public/og.png` passed inspection, use the incoming host to produce an absolute image URL:

```ts
import type { Metadata } from "next";
import { headers } from "next/headers";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  return {
    metadataBase,
    title: "Job Pulse Realtime",
    description: "Personal job monitoring, alerts, source health, and Talent workflow console.",
    openGraph: {
      title: "Job Pulse Realtime",
      description: "Jobs, source health, alerts, and Talent workflows in one console.",
      images: [new URL("/og.png", metadataBase).href],
    },
    twitter: { card: "summary_large_image", images: [new URL("/og.png", metadataBase).href] },
  };
}
```

- [ ] **Step 3: Update README with the implemented frontend scope**

Document the six routes, `npm run dev`, `npm test`, `npm run build`, the Demo data boundary, and the fact that D1/crawler/email are separate future plans. Do not add a real email address or local absolute path.

- [ ] **Step 4: Run final verification**

```bash
npm test
npm run build
git status --short
```

Expected: tests and build PASS; only intended metadata, image, and README files are uncommitted.

- [ ] **Step 5: Commit and push the frontend**

```bash
git add app public/og.png README.md package.json package-lock.json
git commit -m "feat: complete Job Pulse frontend shell"
git push origin main
```

- [ ] **Step 6: Publish with Sites**

Read and follow `sites:sites-hosting`, deploy the validated build, keep the development server alive until hosting succeeds, then stop it. Return the deployed Sites URL as the primary deliverable and the GitHub repository URL as the source link.
