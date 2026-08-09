import { describe, expect, it } from "vitest";
import { mapCrawlActivity, mapJob, sourceHealth } from "./pulse-mappers";

describe("live D1 view mapping", () => {
  it("maps open crawler jobs to a reviewable UI state", () => {
    expect(mapJob({
      id: "job-1",
      source_id: "source-1",
      company: "Acme",
      title: "Risk Analyst",
      location: null,
      arrangement: "unknown",
      summary: null,
      official_url: "https://acme.example/jobs/1",
      first_seen_at: "2026-08-09T00:00:00.000Z",
      last_seen_at: "2026-08-09T02:00:00.000Z",
      review_state: "new",
    })).toMatchObject({
      id: "job-1",
      sourceId: "source-1",
      location: "Location not specified",
      arrangement: "onsite",
      status: "new",
      matchScore: 0,
    });
  });

  it("derives source health from the latest crawl outcome", () => {
    expect(sourceHealth(true, "succeeded")).toBe("healthy");
    expect(sourceHealth(true, "blocked")).toBe("blocked");
    expect(sourceHealth(true, "failed")).toBe("failed");
    expect(sourceHealth(false, null)).toBe("inactive");
  });

  it("turns crawl failures into readable activity", () => {
    expect(mapCrawlActivity({
      id: "run-1",
      company: "Acme",
      status: "failed",
      started_at: "2026-08-09T00:00:00.000Z",
      finished_at: "2026-08-09T00:01:00.000Z",
      jobs_seen: 0,
      jobs_created: 0,
      jobs_updated: 0,
      jobs_closed: 0,
      error: "403",
    })).toMatchObject({
      kind: "source.failed",
      severity: "error",
      summary: "Acme crawl failed.",
      technicalId: "run-1",
    });
  });
});
