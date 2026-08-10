import { describe, expect, it } from "vitest";
import { crawlBatchOptions } from "./crawl-batch-options";

describe("remote crawl batch options", () => {
  it("keeps request-driven crawls below the production write-contention ceiling", () => {
    expect(crawlBatchOptions(undefined)).toEqual({ limit: 8, concurrency: 4 });
    expect(crawlBatchOptions(64)).toEqual({ limit: 8, concurrency: 4 });
    expect(crawlBatchOptions(500)).toEqual({ limit: 8, concurrency: 4 });
    expect(crawlBatchOptions(0)).toEqual({ limit: 1, concurrency: 1 });
  });
});
