import { describe, expect, it } from "vitest";
import { crawlBatchOptions } from "./crawl-batch-options";

describe("remote crawl batch options", () => {
  it("uses a wider bounded batch for remote catalog backfills", () => {
    expect(crawlBatchOptions(undefined)).toEqual({ limit: 16, concurrency: 8 });
    expect(crawlBatchOptions(64)).toEqual({ limit: 64, concurrency: 16 });
    expect(crawlBatchOptions(500)).toEqual({ limit: 64, concurrency: 16 });
    expect(crawlBatchOptions(0)).toEqual({ limit: 1, concurrency: 1 });
  });
});
