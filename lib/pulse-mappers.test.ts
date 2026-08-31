import { describe, expect, it } from "vitest";
import { mapCrawlActivity, mapJob, sourceHealth, utcTimestamp } from "./pulse-mappers";

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

  it("preserves absent structured fields while parsing stored JSON arrays", () => {
    const job = mapJob({
      id: "job-2",
      source_id: "source-1",
      company: "Acme",
      title: "2027 Software Engineering Intern",
      location: "Seattle, WA",
      arrangement: "unknown",
      summary: "Build useful things.",
      official_url: "https://acme.example/jobs/2",
      first_seen_at: "2026-08-09T00:00:00.000Z",
      last_seen_at: "2026-08-09T02:00:00.000Z",
      review_state: "saved",
      employment_type: null,
      department: null,
      salary_min: null,
      salary_max: null,
      skills: '["TypeScript", "SQL"]',
      languages: null,
    });

    expect(job).toMatchObject({
      employmentType: null,
      department: null,
      salaryMin: null,
      salaryMax: null,
      skills: ["TypeScript", "SQL"],
      languages: [],
      arrangement: "onsite",
    });
  });

  it("maps indexed area, region, and posting-date metadata for job rows", () => {
    const job = mapJob({
      id: "job-3",
      source_id: "source-1",
      company: "Acme",
      title: "Machine Learning Software Engineer Intern",
      location: "Austin, TX",
      arrangement: "onsite",
      summary: "Build models.",
      official_url: "https://acme.example/jobs/3",
      first_seen_at: "2026-08-09T00:00:00.000Z",
      last_seen_at: "2026-08-09T02:00:00.000Z",
      review_state: "new",
      location_region: "us",
      area_keys: '["ai-ml","software-engineering","invalid"]',
      published_at: "2026-08-08T00:00:00.000Z",
      resume_match_score: 92,
      resume_match_evidence: '["role:ai-ml|AI or machine learning role|35","skill:python|Python or PySpark|8"]',
    });

    expect(job).toMatchObject({
      locationRegion: "us",
      areaKeys: ["ai-ml", "software-engineering"],
      publishedAt: "2026-08-08T00:00:00.000Z",
      resumeMatchScore: 92,
      resumeMatchEvidence: ["AI or machine learning role", "Python or PySpark"],
    });
  });

  it("derives source health from the latest crawl outcome", () => {
    expect(sourceHealth(true, "succeeded")).toBe("healthy");
    expect(sourceHealth(true, "blocked")).toBe("blocked");
    expect(sourceHealth(true, "failed")).toBe("failed");
    expect(sourceHealth(false, null)).toBe("inactive");
    expect(sourceHealth(true, "succeeded", "2026-08-31 10:00:00", 3, new Date("2026-08-31T17:00:01Z"))).toBe("stale");
    expect(sourceHealth(true, "succeeded", "2026-08-31 16:00:00", 0, new Date("2026-08-31T17:00:00Z"))).toBe("empty");
    expect(sourceHealth(true, "succeeded", "2026-08-31 16:00:00", 3, new Date("2026-08-31T17:00:00Z"))).toBe("healthy");
  });

  it("normalizes D1 timestamps to explicit UTC ISO values", () => {
    expect(utcTimestamp("2026-08-31 16:00:00")).toBe("2026-08-31T16:00:00.000Z");
    expect(utcTimestamp("2026-08-31T16:00:00-07:00")).toBe("2026-08-31T23:00:00.000Z");
    expect(utcTimestamp(null)).toBeNull();
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
