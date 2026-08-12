import { describe, expect, it } from "vitest";
import { runCoverageAudit } from "./audit-crawler-coverage";

describe("runCoverageAudit", () => {
  it("reports every source and exposes a reachable page with no supported listing as failed", async () => {
    const sources = [
      { id: "api", company: "API Co", postingUrl: "https://job-boards.greenhouse.io/acme", adapter: "greenhouse" as const },
      { id: "empty", company: "Empty Co", postingUrl: "https://empty.example/careers", adapter: "custom" as const },
    ];
    const fetcher: typeof fetch = async (input) => String(input).includes("greenhouse")
      ? new Response(JSON.stringify({ jobs: [{ id: 1, title: "Analyst", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1" }] }), { status: 200 })
      : new Response("<html></html>", { status: 200 });

    const report = await runCoverageAudit(sources, fetcher, { concurrency: 2, now: new Date("2026-08-08T12:00:00Z") });

    expect(report).toEqual({
      total: 2,
      byStatus: { succeeded: 1, failed: 1, blocked: 0 },
      sources: [
        expect.objectContaining({ id: "api", status: "succeeded", jobsExtracted: 1 }),
        expect.objectContaining({
          id: "empty",
          status: "failed",
          jobsExtracted: 0,
          error: expect.stringMatching(/supported public job feed/i),
        }),
      ],
    });
  });

  it("records the official listing URL that recovered a careers landing page", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://acme.example/careers") {
        return new Response('<a href="https://careers.acme.example/search-jobs">Search jobs</a>', { status: 200 });
      }
      if (url === "https://careers.acme.example/search-jobs") {
        return new Response('<a href="/jobs/software-engineer">Software Engineer</a>', { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };

    const report = await runCoverageAudit([{
      id: "acme",
      company: "Acme",
      postingUrl: "https://acme.example/careers",
      adapter: "custom",
    }], fetcher, { now: new Date("2026-08-11T23:00:00Z") });

    expect(report.sources[0]).toEqual(expect.objectContaining({
      status: "succeeded",
      jobsExtracted: 1,
      resolvedListingUrl: "https://careers.acme.example/search-jobs",
    }));
  });
});
