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
});
