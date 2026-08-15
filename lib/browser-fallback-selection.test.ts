import { describe, expect, it } from "vitest";
import { browserRecoveryDue, needsBrowserFallback, shouldRecordBrowserResult } from "./browser-fallback-selection";

describe("needsBrowserFallback", () => {
  it("selects a reachable source when its latest crawl extracted no jobs", () => {
    expect(needsBrowserFallback({ status: "succeeded", jobsSeen: 0 })).toBe(true);
  });

  it("does not re-run a successful source that already extracted jobs", () => {
    expect(needsBrowserFallback({ status: "succeeded", jobsSeen: 12 })).toBe(false);
  });

  it.each(["blocked", "failed"] as const)("selects a %s source", (status) => {
    expect(needsBrowserFallback({ status, jobsSeen: 0 })).toBe(true);
  });

  it("selects a source that has never completed a crawl", () => {
    expect(needsBrowserFallback({ status: null, jobsSeen: null })).toBe(true);
  });

  it("selects a successful populated source during a forced full audit", () => {
    expect(needsBrowserFallback({ status: "succeeded", jobsSeen: 12 }, true)).toBe(true);
  });
});

describe("browser fallback result precedence", () => {
  it.each(["failed", "blocked"] as const)("does not let a %s browser observation downgrade a successful crawl", (status) => {
    expect(shouldRecordBrowserResult("succeeded", status)).toBe(false);
  });

  it("records a browser recovery that finds jobs", () => {
    expect(shouldRecordBrowserResult("failed", "succeeded")).toBe(true);
  });

  it.each(["failed", "blocked"] as const)("preserves a native %s reason when browser recovery also fails", (previous) => {
    expect(shouldRecordBrowserResult(previous, "failed")).toBe(false);
  });

  it("records a browser failure only when the source has no prior result", () => {
    expect(shouldRecordBrowserResult(null, "failed")).toBe(true);
  });
});

describe("browser recovery queue timing", () => {
  const now = Date.parse("2026-08-15T02:20:00.000Z");

  it("immediately admits a newly failed native source despite its backoff", () => {
    expect(browserRecoveryDue({
      health: "failed", currentJobs: 2_055,
      lastCheckedAt: "2026-08-15T02:15:00.000Z",
      nextRunAt: "2026-08-15T08:15:00.000Z",
    }, now)).toBe(true);
  });

  it("does not repeatedly bypass backoff for an old failure", () => {
    expect(browserRecoveryDue({
      health: "blocked", currentJobs: 10,
      lastCheckedAt: "2026-08-14T20:00:00.000Z",
      nextRunAt: "2026-08-15T20:00:00.000Z",
    }, now)).toBe(false);
  });

  it("still admits any problem source whose normal retry is due", () => {
    expect(browserRecoveryDue({
      health: "inactive", currentJobs: 0,
      lastCheckedAt: null, nextRunAt: "2026-08-15T02:19:00.000Z",
    }, now)).toBe(true);
  });

  it("never queues a populated healthy source", () => {
    expect(browserRecoveryDue({
      health: "healthy", currentJobs: 42,
      lastCheckedAt: "2026-08-15T02:19:00.000Z", nextRunAt: null,
    }, now)).toBe(false);
  });
});
