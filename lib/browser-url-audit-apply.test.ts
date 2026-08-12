import { describe, expect, it } from "vitest";
import { buildRemediatedCatalog } from "./browser-url-audit-apply";

describe("buildRemediatedCatalog", () => {
  it("preserves each source verification date while applying an official URL override", () => {
    const source = {
      masterRow: 42,
      company: "Acme",
      id: "acme",
      postingUrl: "https://acme.example/careers",
      talentUrl: null,
      channel: "Official careers",
      adapter: "custom" as const,
      verification: "career_only" as const,
      confidence: "high" as const,
      resumeUpload: "unknown" as const,
      jobAlerts: "unknown" as const,
      enabled: true,
      checkedAt: "2026-08-11",
    };

    const result = buildRemediatedCatalog(
      [source],
      [],
      { overrides: { acme: { url: "https://acme.wd1.myworkdayjobs.com/Careers", adapter: "workday" } }, rejectedRecommendations: [] },
    );

    expect(result.applied).toBe(1);
    expect(result.records[0]).toEqual(expect.objectContaining({
      checkedAt: "2026-08-11",
      postingUrl: "https://acme.wd1.myworkdayjobs.com/Careers",
      adapter: "workday",
    }));
  });
});
