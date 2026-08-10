import { describe, expect, it } from "vitest";
import { assertAiDataTopicAudit, buildAiDataTopicAudit } from "./audit-ai-data-topic";

describe("AI/data topic audit", () => {
  it("groups evidence, reports coverage, and emits a deterministic bounded URL sample", () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({
      id: `job-${String(index).padStart(3, "0")}`,
      company: index === 0 ? "Acme" : "Example",
      title: index === 0 ? "Machine Learning Engineer" : `Data Engineer ${index}`,
      officialUrl: `https://jobs.example/${index}`,
      score: 4,
      evidence: index % 2 === 0 ? ["title:machine learning"] : ["title:data engineering"],
    }));

    const report = buildAiDataTopicAudit({ openTotal: 1_000, rows, knownTitles: ["Machine Learning Engineer"] });

    expect(report).toMatchObject({ openTotal: 1_000, matchedOpen: 120, coveragePercent: 12, knownTitleMisses: [] });
    expect(report.sample).toHaveLength(100);
    expect(report.sample[0]).toEqual(expect.objectContaining({
      company: "Acme",
      title: "Machine Learning Engineer",
      officialUrl: "https://jobs.example/0",
    }));
    expect(report.evidenceGroups).toEqual([
      { evidence: "title:data engineering", count: 60 },
      { evidence: "title:machine learning", count: 60 },
    ]);
    expect(() => assertAiDataTopicAudit(report)).not.toThrow();
  });

  it("fails validation when a known AI/data title is missing", () => {
    const report = buildAiDataTopicAudit({
      openTotal: 10,
      rows: [],
      knownTitles: ["Applied Scientist, Search"],
    });

    expect(report.knownTitleMisses).toEqual(["Applied Scientist, Search"]);
    expect(() => assertAiDataTopicAudit(report)).toThrow("Known AI/data titles missing");
  });
});
