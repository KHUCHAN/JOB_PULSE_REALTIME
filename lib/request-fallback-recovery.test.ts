import { describe, expect, it, vi } from "vitest";
import type { CrawlSource, SourceCrawlResult } from "./crawler";
import { isRequestFallbackDue, recoverCheckpointedCatalog } from "./request-fallback-recovery";

const source: CrawlSource = {
  id: "checkpointed",
  company: "Checkpointed",
  postingUrl: "https://example.com/jobs",
  adapter: "custom",
};

const job = (id: string): SourceCrawlResult["jobs"][number] => ({
  externalId: id,
  title: `Role ${id}`,
  company: source.company,
  location: "New York",
  arrangement: "unknown",
  employmentType: null,
  summary: null,
  officialUrl: `https://example.com/jobs/${id}`,
  publishedAt: null,
});

describe("request fallback checkpoint recovery", () => {
  it("skips a source already scheduled beyond the bounded handoff horizon", () => {
    const now = new Date("2026-08-25T15:00:00.000Z");
    expect(isRequestFallbackDue(null, now)).toBe(true);
    expect(isRequestFallbackDue("invalid", now)).toBe(true);
    expect(isRequestFallbackDue("2026-08-25T15:05:00.000Z", now)).toBe(true);
    expect(isRequestFallbackDue("2026-08-25T15:05:00.001Z", now)).toBe(false);
    expect(isRequestFallbackDue("2026-08-25T17:00:00.000Z", now)).toBe(false);
  });

  it("runs an explicitly forced priority source on every workflow", () => {
    const now = new Date("2026-08-25T15:00:00.000Z");
    expect(isRequestFallbackDue("2026-08-25T17:00:00.000Z", now, true)).toBe(true);
  });

  it("joins bounded windows and removes the repeated page-one jobs", async () => {
    const crawl = vi.fn(async (requested: CrawlSource): Promise<SourceCrawlResult> => {
      if (requested.crawlPageCursor === 1) return {
        status: "succeeded", responseStatus: 200, completeListing: false,
        jobs: [job("a"), job("b")], pagination: { nextPage: 3, cycleComplete: false, totalPages: 5 }, error: null,
      };
      if (requested.crawlPageCursor === 3) return {
        status: "succeeded", responseStatus: 200, completeListing: false,
        jobs: [job("a"), job("c"), job("d")], pagination: { nextPage: 5, cycleComplete: false, totalPages: 5 }, error: null,
      };
      return {
        status: "succeeded", responseStatus: 200, completeListing: false,
        jobs: [job("a"), job("e")], pagination: { nextPage: 1, cycleComplete: true, totalPages: 5 }, error: null,
      };
    });

    const result = await recoverCheckpointedCatalog(source, fetch, crawl);
    expect(crawl.mock.calls.map(([requested]) => requested.crawlPageCursor)).toEqual([1, 3, 5]);
    expect(result.jobs.map((value) => value.externalId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.completeListing).toBe(false);
    expect(result.pagination).toBeUndefined();
  });

  it("retries one stalled window and then fails without claiming completeness", async () => {
    const crawl = vi.fn(async (): Promise<SourceCrawlResult> => ({
      status: "succeeded", responseStatus: 200, completeListing: false,
      jobs: [job("a")], pagination: { nextPage: 5, cycleComplete: false, totalPages: 8 }, error: null,
    }));
    const wait = vi.fn(async () => undefined);
    await expect(recoverCheckpointedCatalog(
      { ...source, crawlPageCursor: 5 },
      fetch,
      crawl,
      { maxStalls: 1, stallDelayMs: 1, wait },
    )).rejects.toThrow("did not advance");
    expect(wait).toHaveBeenCalledOnce();
  });

  it("keeps a non-authoritative tail snapshot when Workday page one drifts", async () => {
    const crawl = vi.fn(async (requested: CrawlSource): Promise<SourceCrawlResult> => {
      if (requested.crawlPageCursor === 1) return {
        status: "succeeded", responseStatus: 200, completeListing: false,
        jobs: [job("a")], pagination: { nextPage: 70, cycleComplete: false, totalPages: 100 }, error: null,
      };
      return {
        status: "succeeded", responseStatus: 200, completeListing: false,
        jobs: [job("b")], pagination: { nextPage: 1, cycleComplete: false, totalPages: 100 }, error: null,
      };
    });

    const result = await recoverCheckpointedCatalog(source, fetch, crawl, { maxStalls: 0 });
    expect(crawl.mock.calls.map(([requested]) => requested.crawlPageCursor)).toEqual([1, 70]);
    expect(result.jobs.map((value) => value.externalId)).toEqual(["a", "b"]);
    expect(result.completeListing).toBe(false);
    expect(result.pagination).toBeUndefined();
  });

  it("keeps enriched fields from the first observation across overlapping windows", async () => {
    const crawl = vi.fn(async (requested: CrawlSource): Promise<SourceCrawlResult> => {
      if (requested.crawlPageCursor === 1) return {
        status: "succeeded", responseStatus: 200, completeListing: false,
        jobs: [{ ...job("a"), description: "enriched detail" }],
        pagination: { nextPage: 2, cycleComplete: false, totalPages: 2 }, error: null,
      };
      return {
        status: "succeeded", responseStatus: 200, completeListing: false,
        jobs: [job("a"), job("b")],
        pagination: { nextPage: 1, cycleComplete: true, totalPages: 2 }, error: null,
      };
    });

    const result = await recoverCheckpointedCatalog(source, fetch, crawl);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs.find((value) => value.externalId === "a")?.description).toBe("enriched detail");
  });

  it("retains one non-authoritative segment for an intentionally rotating giant catalog", async () => {
    const crawl = vi.fn(async (): Promise<SourceCrawlResult> => ({
      status: "succeeded", responseStatus: 200, completeListing: false,
      jobs: [job("a"), job("b")],
      pagination: { nextPage: 20, cycleComplete: false, totalPages: 360 }, error: null,
    }));

    const result = await recoverCheckpointedCatalog(source, fetch, crawl, {
      maxPasses: 1,
      maxStalls: 0,
      retainPartialAtPassLimit: true,
    });

    expect(crawl).toHaveBeenCalledOnce();
    expect(result.jobs.map((value) => value.externalId)).toEqual(["a", "b"]);
    expect(result.completeListing).toBe(false);
    expect(result.pagination).toBeUndefined();
  });
});
