import { describe, expect, it } from "vitest";
import { crawlBatchOptions, recrawlSourceIds } from "./crawl-batch-options";

describe("remote crawl batch options", () => {
  it("keeps request-driven crawls below the production write-contention ceiling", () => {
    expect(crawlBatchOptions(undefined)).toEqual({ limit: 4, concurrency: 2 });
    expect(crawlBatchOptions(64)).toEqual({ limit: 4, concurrency: 2 });
    expect(crawlBatchOptions(500)).toEqual({ limit: 4, concurrency: 2 });
    expect(crawlBatchOptions(0)).toEqual({ limit: 1, concurrency: 1 });
  });
});

describe("targeted recrawl source IDs", () => {
  it("accepts unique non-empty IDs and enforces the production batch cap", () => {
    expect(recrawlSourceIds([" source-a ", "source-a", "", 42, ...Array.from({ length: 12 }, (_, index) => `source-${index}`)]))
      .toEqual(["source-a", "source-0", "source-1", "source-2"]);
    expect(recrawlSourceIds("source-a")).toEqual([]);
  });
});
