import { describe, expect, it } from "vitest";
import { needsBrowserFallback, shouldRecordBrowserResult } from "./browser-fallback-selection";

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

  it.each(["failed", "blocked", null] as const)("keeps a %s source failure visible", (previous) => {
    expect(shouldRecordBrowserResult(previous, "failed")).toBe(true);
  });
});
