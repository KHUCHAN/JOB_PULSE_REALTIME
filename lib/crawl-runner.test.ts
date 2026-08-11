import { describe, expect, it } from "vitest";
import { runDueCrawls, runSpecificCrawls, type CrawlStore, type PersistedSource } from "./crawl-runner";
import type { CrawledJob } from "./crawler";

class MemoryStore implements CrawlStore {
  constructor(readonly sources: PersistedSource[], private readonly failSync = false) {}

  readonly runs: Array<Record<string, unknown>> = [];
  readonly synced: Array<{ sourceId: string; jobs: CrawledJob[]; completeListing: boolean }> = [];

  async dueSources(): Promise<PersistedSource[]> {
    return this.sources;
  }

  async startRun(source: PersistedSource, scheduledFor: string): Promise<string> {
    const id = `run-${source.id}`;
    this.runs.push({ id, sourceId: source.id, scheduledFor, status: "running" });
    return id;
  }

  async syncJobs(sourceId: string, jobs: CrawledJob[], completeListing: boolean): Promise<{ created: number; updated: number; closed: number }> {
    if (this.failSync) throw new Error("D1 unavailable");
    this.synced.push({ sourceId, jobs, completeListing });
    return { created: jobs.length, updated: 0, closed: completeListing ? 1 : 0 };
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
    expect(store.sources[0].nextCrawlAt).toBe("2026-08-08T14:00:00.000Z");
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

});
