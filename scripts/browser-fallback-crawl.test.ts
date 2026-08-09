import { describe, expect, it } from "vitest";
import { persistenceSql, type BrowserFallbackResult } from "./browser-fallback-crawl";

describe("browser fallback enriched persistence", () => {
  it("keeps structured filter fields recovered by Chrome", () => {
    const result: BrowserFallbackResult = {
      source: { id: "source-1", company: "Acme", postingUrl: "https://acme.example/jobs", adapter: "custom" },
      status: 200,
      finalUrl: "https://acme.example/jobs",
      error: null,
      jobs: [{
        externalId: "REQ-1", title: "Data Engineer", company: "Acme", location: "Austin, TX",
        arrangement: "hybrid", employmentType: "Full-time", summary: "Build data.", description: "Build trusted data products.",
        department: "Platform", skills: ["SQL", "Python"], salaryMin: 120000, salaryMax: 160000,
        salaryCurrency: "USD", salaryInterval: "year", officialUrl: "https://acme.example/jobs/1", publishedAt: "2026-08-01T00:00:00.000Z",
      }],
      facets: [{ key: "department", label: "Department", values: [{ key: "Platform", label: "Platform", count: 1 }] }],
    };

    const sql = persistenceSql([result]);

    expect(sql).toContain("description, responsibilities, qualifications, skills, department");
    expect(sql).toContain("'Build trusted data products.'");
    expect(sql).toContain("'[\"SQL\",\"Python\"]'");
    expect(sql).toContain("120000, 160000, 'USD', 'year'");
    expect(sql).toContain("skills=CASE WHEN excluded.skills <> '[]' THEN excluded.skills ELSE jobs.skills END");
    expect(sql).toContain("secondary_locations=CASE WHEN excluded.secondary_locations <> '[]' THEN excluded.secondary_locations ELSE jobs.secondary_locations END");
    expect(sql).toContain("languages=CASE WHEN excluded.languages <> '[]' THEN excluded.languages ELSE jobs.languages END");
    expect(sql).toContain("external_id=COALESCE(excluded.external_id,jobs.external_id)");
    expect(sql).toContain("location=COALESCE(excluded.location,jobs.location)");
    expect(sql).toContain("arrangement=CASE WHEN excluded.arrangement='unknown' THEN jobs.arrangement ELSE excluded.arrangement END");
    expect(sql).toContain("employment_type=COALESCE(excluded.employment_type,jobs.employment_type)");
    expect(sql).toContain("INSERT INTO source_facets");
    expect(sql).toContain("'department', 'Department', 'Platform', 'Platform', 1");
  });
});
