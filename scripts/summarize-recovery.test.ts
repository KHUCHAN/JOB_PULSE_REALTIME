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
  it("reports long-tail bot walls and parser misses without failing the owner run", () => {
    const tesla: BrowserFallbackResult = {
      source: { id: "tesla", company: "Tesla", postingUrl: "https://www.tesla.com/careers", adapter: "custom" },
      status: 403, jobs: [], finalUrl: null, error: "Tesla careers returned HTTP 403.",
    };
    const cgi: BrowserFallbackResult = { ...row, source: { ...row.source, id: "cgi", company: "CGI" }, authoritativeEmpty: false };
    const report = summarizeRecovery(emptyRequest, emptyRequest, { completed: true, results: [tesla, cgi] },
      { sources: [{ id: "google", collectionStatus: "succeeded" }] });
    expect(report).toMatchObject({
      status: "degraded",
      unresolvedSourceIds: ["cgi", "tesla"],
      browserFailures: [expect.objectContaining({ code: "blocked_challenge" }), expect.objectContaining({ code: "empty_board" })],
    });
  });
  it("keeps lost recovered jobs fatal even when critical coverage is clean", () => {
    const job = { externalId: "1", title: "Intern", company: "AMD", location: "Austin", arrangement: "unknown" as const,
      employmentType: null, summary: null, officialUrl: "https://careers.amd.com/jobs/1", publishedAt: null };
    expect(summarizeRecovery(emptyRequest, emptyRequest, { completed: true, results: [{ ...row, jobs: [job], authoritativeEmpty: false, persistenceError: "HTTP 500" }] },
      { sources: [{ id: "google", collectionStatus: "succeeded" }] }).status).toBe("partial_failure");
  });
  it("reports a missed failure-status write as degraded because no collected rows were lost", () => {
    const deadPage: BrowserFallbackResult = { ...row, status: 404, authoritativeEmpty: false,
      persistenceError: "Production browser result recording failed: The operation was aborted due to timeout" };
    expect(summarizeRecovery(emptyRequest, emptyRequest, { completed: true, results: [deadPage] },
      { sources: [{ id: "google", collectionStatus: "succeeded" }] })).toMatchObject({
      status: "degraded", browserFailures: [expect.objectContaining({ code: "ingest_error" })],
    });
  });
  it("keeps an unrecovered critical employer fatal", () => {
    const google = { attempted: 1, summaries: [{ sourceId: "google", status: "failed" }] };
    const blocked: BrowserFallbackResult = { ...row, source: { ...row.source, id: "google", company: "Google" }, status: 403, authoritativeEmpty: false };
    expect(summarizeRecovery(google, emptyRequest, { completed: true, results: [blocked] },
      { sources: [{ id: "google", collectionStatus: "failed" }] })).toMatchObject({
      status: "partial_failure", unresolvedSourceIds: ["google"], auditErrors: [expect.objectContaining({ id: "google" })],
    });
  });
  it("does not hide a raw DB audit error after a browser success", () => {
    expect(summarizeRecovery(request, emptyRequest, { completed: true, results: [row] }, { sources: [{ id: "amd", error: "DB HTTP 503" }] }).status)
      .toBe("partial_failure");
  });
});
