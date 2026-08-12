import { describe, expect, it } from "vitest";
import { crawlBatchOptions, jobAreaRegionBackfillLimit, jobProgramBackfillLimit, jobTopicBackfillLimit, recrawlSourceIds } from "./crawl-batch-options";

describe("remote crawl batch options", () => {
  it("isolates every source in its own production Worker request", () => {
    expect(crawlBatchOptions(undefined)).toEqual({ limit: 1, concurrency: 1 });
    expect(crawlBatchOptions(64)).toEqual({ limit: 1, concurrency: 1 });
    expect(crawlBatchOptions(500)).toEqual({ limit: 1, concurrency: 1 });
    expect(crawlBatchOptions(0)).toEqual({ limit: 1, concurrency: 1 });
  });
});

describe("job program backfill limits", () => {
  it("uses large bounded batches because classification only reads titles", () => {
    expect(jobProgramBackfillLimit(undefined)).toBe(5_000);
    expect(jobProgramBackfillLimit(0)).toBe(1);
    expect(jobProgramBackfillLimit(50_000)).toBe(5_000);
  });
});

describe("targeted recrawl source IDs", () => {
  it("accepts unique non-empty IDs and enforces the production batch cap", () => {
    expect(recrawlSourceIds([" source-a ", "source-a", "", 42, ...Array.from({ length: 12 }, (_, index) => `source-${index}`)]))
      .toEqual(["source-a", "source-0", "source-1", "source-2"]);
    expect(recrawlSourceIds("source-a")).toEqual([]);
  });
});

describe("job topic backfill limits", () => {
  it("defaults to 250 and caps private backfill requests at 500 jobs", () => {
    expect(jobTopicBackfillLimit(undefined)).toBe(250);
    expect(jobTopicBackfillLimit(0)).toBe(1);
    expect(jobTopicBackfillLimit(250)).toBe(250);
    expect(jobTopicBackfillLimit(5_000)).toBe(500);
  });
});

describe("job area and region backfill limits", () => {
  it("uses integer batches capped at the D1-safe 800 jobs", () => {
    expect(jobAreaRegionBackfillLimit(undefined)).toBe(800);
    expect(jobAreaRegionBackfillLimit(0)).toBe(1);
    expect(jobAreaRegionBackfillLimit(42.9)).toBe(42);
    expect(jobAreaRegionBackfillLimit(5_000)).toBe(800);
  });
});
