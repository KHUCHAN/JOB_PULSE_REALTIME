import { describe, expect, it } from "vitest";
import { summarizeRecovery } from "./summarize-recovery";
import type { BrowserFallbackResult } from "./browser-fallback-crawl";
const request = { attempted: 1, summaries: [{ sourceId: "amd", status: "failed" }] };
const emptyRequest = { attempted: 0, summaries: [] };
const row: BrowserFallbackResult = {
  source: { id: "amd", company: "AMD", postingUrl: "https://careers.amd.com/jobs", adapter: "custom" },
  status: 200, jobs: [], finalUrl: "https://careers.amd.com/jobs", error: null, authoritativeEmpty: true,
};
const audit = { sources: [{ id: "amd", collectionStatus: "failed" }] };
describe("final owner recovery outcome", () => {
  it("resolves a request failure only after completed successful browser persistence", () => {
    expect(summarizeRecovery(request, emptyRequest, { completed: true, results: [row] }, audit)).toMatchObject({
      status: "succeeded", unresolvedSourceIds: [], recoveredAfterRequestFailure: ["amd"], authoritativeEmpty: [expect.anything()],
    });
  });
  it("does not count a verified empty board as a failure, or an unknown empty shell as healthy", () => {
    const report = summarizeRecovery(request, emptyRequest, { completed: true, results: [{ ...row, authoritativeEmpty: false }] }, audit);
    expect(report.status).toBe("partial_failure");
    expect(report.browserFailures[0].code).toBe("empty_board");
    expect(report.authoritativeEmpty).toEqual([]);
  });
  it("keeps persistence failures and missing evidence fatal", () => {
    expect(summarizeRecovery(request, emptyRequest, { completed: true, results: [{ ...row, persistenceError: "HTTP 500" }] }, audit))
      .toMatchObject({ status: "partial_failure", unresolvedSourceIds: ["amd"], browserFailures: [expect.objectContaining({ code: "ingest_error" })] });
    for (const evidence of [{ results: [row] }, null, { completed: true, results: [{}] }])
      expect(() => summarizeRecovery(request, emptyRequest, evidence, audit)).toThrow();
    expect(() => summarizeRecovery({}, emptyRequest, { completed: true, results: [] }, audit)).toThrow();
  });
  it("does not hide a raw DB audit error after a browser success", () => {
    expect(summarizeRecovery(request, emptyRequest, { completed: true, results: [row] }, { sources: [{ id: "amd", error: "DB HTTP 503" }] }).status)
      .toBe("partial_failure");
  });
});
