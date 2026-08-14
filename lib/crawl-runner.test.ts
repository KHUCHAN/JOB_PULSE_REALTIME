import { describe, expect, it } from "vitest";
import { runDueCrawls, runSpecificCrawls, type CrawlStore, type PersistedSource } from "./crawl-runner";
import type { CrawledJob } from "./crawler";

class MemoryStore implements CrawlStore {
  constructor(readonly sources: PersistedSource[], private readonly failSync = false) {}

  readonly runs: Array<Record<string, unknown>> = [];
  readonly synced: Array<{ sourceId: string; jobs: CrawledJob[]; completeListing: boolean; suppressNotifications?: boolean }> = [];
  readonly paged: Array<{ sourceId: string; nextPage: number; cycleComplete: boolean; cycleStartedAt: string; previousCycleStartedAt: string | null }> = [];
  readonly resolvedListings: Array<{ sourceId: string; previousUrl: string; postingUrl: string; adapter: PersistedSource["adapter"] }> = [];

  async dueSources(): Promise<PersistedSource[]> {
    return this.sources;
  }

  async startRun(source: PersistedSource, scheduledFor: string): Promise<string> {
    const id = `run-${source.id}`;
    this.runs.push({ id, sourceId: source.id, scheduledFor, status: "running" });
    return id;
  }

  async syncJobs(
    sourceId: string,
    jobs: CrawledJob[],
    completeListing: boolean,
    _facets?: unknown,
    options?: { suppressNotifications?: boolean },
  ): Promise<{ created: number; updated: number; closed: number }> {
    if (this.failSync) throw new Error("D1 unavailable");
    this.synced.push({ sourceId, jobs, completeListing, suppressNotifications: options?.suppressNotifications });
    return { created: jobs.length, updated: 0, closed: completeListing ? 1 : 0 };
  }

  async advancePagedCrawl(
    sourceId: string,
    pagination: { nextPage: number; cycleComplete: boolean; totalPages: number },
    cycleStartedAt: string,
    previousCycleStartedAt: string | null,
  ): Promise<{ closed: number }> {
    this.paged.push({ sourceId, nextPage: pagination.nextPage, cycleComplete: pagination.cycleComplete, cycleStartedAt, previousCycleStartedAt });
    return { closed: pagination.cycleComplete && previousCycleStartedAt ? 2 : 0 };
  }

  async updateResolvedListing(sourceId: string, previousUrl: string, postingUrl: string, adapter: PersistedSource["adapter"]): Promise<void> {
    this.resolvedListings.push({ sourceId, previousUrl, postingUrl, adapter });
  }

  async finishRun(runId: string, values: Record<string, unknown>): Promise<void> {
    Object.assign(this.runs.find((run) => run.id === runId)!, values);
  }

  async scheduleNext(sourceId: string, nextCrawlAt: string): Promise<void> {
    Object.assign(this.sources.find((source) => source.id === sourceId)!, { nextCrawlAt });
  }
}

describe("runDueCrawls", () => {
  it("persists a successful complete feed and schedules that source two hours later", async () => {
    const store = new MemoryStore([{
      id: "acme",
      company: "Acme",
      postingUrl: "https://job-boards.greenhouse.io/acme",
      adapter: "greenhouse",
      nextCrawlAt: null,
    }]);
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      jobs: [{ id: 42, title: "Data Engineer", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/42" }],
    }), { status: 200 });

    const result = await runDueCrawls(store, fetcher, new Date("2026-08-08T12:00:00Z"), { concurrency: 1 });

    expect(result).toEqual({ attempted: 1, succeeded: 1, failed: 0, blocked: 0, created: 1, updated: 0, closed: 1 });
    expect(store.synced).toEqual([expect.objectContaining({ sourceId: "acme", completeListing: true })]);
    expect(store.runs).toEqual([expect.objectContaining({
      status: "succeeded",
      responseStatus: 200,
      jobsSeen: 1,
      jobsCreated: 1,
      jobsUpdated: 0,
      jobsClosed: 1,
    })]);
    expect(store.sources[0].nextCrawlAt).toBe("2026-08-08T14:00:00.000Z");
  });

  it("backs blocked sources off for a day instead of retrying them every batch", async () => {
    const store = new MemoryStore([{
      id: "blocked",
      company: "Blocked",
      postingUrl: "https://blocked.example/careers",
      adapter: "custom",
      nextCrawlAt: null,
    }]);
    const fetcher: typeof fetch = async () => new Response("challenge", { status: 403 });

    await expect(runDueCrawls(store, fetcher, new Date("2026-08-08T12:00:00Z"), { concurrency: 1 }))
      .resolves.toEqual(expect.objectContaining({ blocked: 1 }));
    expect(store.sources[0].nextCrawlAt).toBe("2026-08-09T12:00:00.000Z");
  });

  it("records a failed run when persistence fails and continues the batch", async () => {
    const store = new MemoryStore([{
      id: "acme",
      company: "Acme",
      postingUrl: "https://job-boards.greenhouse.io/acme",
      adapter: "greenhouse",
      nextCrawlAt: null,
    }], true);
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      jobs: [{ id: 42, title: "Data Engineer", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/42" }],
    }), { status: 200 });

    await expect(runDueCrawls(store, fetcher, new Date("2026-08-08T12:00:00Z"), { concurrency: 1 })).resolves.toEqual({
      attempted: 1,
      succeeded: 0,
      failed: 1,
      blocked: 0,
      created: 0,
      updated: 0,
      closed: 0,
    });
    expect(store.runs).toEqual([expect.objectContaining({ status: "failed", error: "D1 unavailable" })]);
    expect(store.sources[0].nextCrawlAt).toBe("2026-08-08T18:00:00.000Z");
  });

  it("recrawls an explicit bounded source set without leasing unrelated due sources", async () => {
    const source = {
      id: "repair-me",
      company: "Acme",
      postingUrl: "https://job-boards.greenhouse.io/acme",
      adapter: "greenhouse" as const,
      nextCrawlAt: "2026-08-08T14:00:00.000Z",
    };
    const store = new MemoryStore([source]);
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ jobs: [] }), { status: 200 });

    await expect(runSpecificCrawls(store, [source], fetcher, new Date("2026-08-08T12:00:00Z"), { concurrency: 1 }))
      .resolves.toEqual(expect.objectContaining({ attempted: 1, succeeded: 1 }));
    expect(store.synced).toEqual([expect.objectContaining({ sourceId: "repair-me" })]);
  });

  it("promotes a verified listing URL after its discovered jobs are persisted", async () => {
    const source: PersistedSource = {
      id: "acme",
      company: "Acme",
      postingUrl: "https://www.acme.example/careers",
      adapter: "custom",
      nextCrawlAt: null,
    };
    const store = new MemoryStore([source]);
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === source.postingUrl) return new Response('<a href="https://careers.acme.example/search-jobs">Search jobs</a>');
      if (url === "https://careers.acme.example/search-jobs") return new Response('<script>widget({"company_code":"Acme"})</script>');
      if (url === "https://api.smartrecruiters.com/v1/companies/Acme/postings?limit=100&offset=0") return Response.json({
        offset: 0,
        limit: 100,
        totalFound: 1,
        content: [{ id: "1", name: "AI Intern", ref: "https://api.smartrecruiters.com/v1/companies/Acme/postings/1" }],
      });
      return new Response("missing", { status: 404 });
    };

    await runDueCrawls(store, fetcher, new Date("2026-08-12T12:00:00Z"), { concurrency: 1 });

    expect(store.resolvedListings).toEqual([{
      sourceId: "acme",
      previousUrl: "https://www.acme.example/careers",
      postingUrl: "https://careers.acme.example/search-jobs",
      adapter: "custom",
    }]);
  });

  it("advances a paged crawl checkpoint and closes stale rows only after the final page window", async () => {
    const source: PersistedSource = {
      id: "p4-0285-google",
      company: "Google / Alphabet",
      postingUrl: "https://www.google.com/about/careers/applications/jobs/results/",
      adapter: "custom",
      nextCrawlAt: null,
      crawlPageCursor: 21,
      crawlCycleStartedAt: "2026-08-08T08:00:00.000Z",
      crawlPreviousCycleStartedAt: "2026-08-07T08:00:00.000Z",
    };
    const store = new MemoryStore([source]);
    const page = (start: number, count: number) => Array.from({ length: count }, (_, index) => {
      const id = start + index;
      return `<a href="/about/careers/applications/jobs/results/${id}-role-${id}" aria-label="Learn more about Role ${id}"></a>`;
    }).join("");
    const fetcher: typeof fetch = async (input) => {
      const pageNumber = Number(new URL(String(input)).searchParams.get("page") ?? 1);
      return new Response(`<span class="SWhIm">421</span> jobs matched ${page(pageNumber * 100, pageNumber === 22 ? 1 : 20)}`, { status: 200 });
    };

    const result = await runDueCrawls(store, fetcher, new Date("2026-08-08T12:00:00.000Z"), { concurrency: 1 });

    expect(result).toEqual(expect.objectContaining({ succeeded: 1, closed: 2 }));
    expect(store.synced[0]).toEqual(expect.objectContaining({ completeListing: false, suppressNotifications: false }));
    expect(store.paged).toEqual([{
      sourceId: "p4-0285-google",
      nextPage: 1,
      cycleComplete: true,
      cycleStartedAt: "2026-08-08T08:00:00.000Z",
      previousCycleStartedAt: "2026-08-07T08:00:00.000Z",
    }]);
  });

});
