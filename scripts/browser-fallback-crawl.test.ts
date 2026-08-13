import { describe, expect, it } from "vitest";
import type { CrawledJob, CrawlSource } from "../lib/crawler";
import { browserResultClassification, persistenceSql, type BrowserFallbackResult } from "./browser-fallback-crawl";

describe("browser fallback persistenceSql", () => {
  it("persists location region and replaces direct managed job areas", () => {
    const source: CrawlSource = {
      id: "source-1",
      company: "Acme",
      postingUrl: "https://jobs.example.com",
      adapter: "custom",
    };
    const job = {
      externalId: "swe-1",
      title: "Summer 2027 Software Engineering Internship",
      company: "Acme",
      location: "Austin, TX",
      locationCountry: "United States",
      arrangement: "onsite",
      employmentType: "Internship",
      summary: "Build software.",
      officialUrl: "https://jobs.example.com/swe-1",
      publishedAt: "2026-08-10T00:00:00.000Z",
    } satisfies CrawledJob;
    const result: BrowserFallbackResult = {
      source,
      status: 200,
      finalUrl: source.postingUrl,
      jobs: [job],
      error: null,
    };

    const sql = persistenceSql([result]);

    expect(sql).toContain("location_region");
    expect(sql).toContain("area_classified_at");
    expect(sql).toMatch(/v3:\d{4}-\d{2}-\d{2}T/);
    expect(sql).toContain("location_region=CASE WHEN excluded.location_region='unknown'");
    expect(sql).toContain("DELETE FROM job_topics WHERE topic_key LIKE 'area:%'");
    expect(sql).toContain("area:software-engineering");
  });
});

describe("browser fallback result classification", () => {
  it("keeps a 2xx page with no verified jobs retryable instead of healthy", () => {
    expect(browserResultClassification({
      source: {
        id: "source-empty",
        company: "Acme",
        postingUrl: "https://jobs.example.com",
        adapter: "custom",
      },
      status: 200,
      finalUrl: "https://jobs.example.com",
      jobs: [],
      error: null,
    })).toEqual({ status: "failed", code: "empty_board" });
  });
});
