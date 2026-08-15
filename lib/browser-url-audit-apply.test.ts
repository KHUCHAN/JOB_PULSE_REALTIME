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

  it("updates a stale Talent URL and merger channel from an official override", () => {
    const source = {
      masterRow: 43,
      company: "Legacy Bank",
      id: "legacy-bank",
      postingUrl: "https://legacy.example/careers",
      talentUrl: "https://legacy.example/talent",
      channel: "Official careers",
      adapter: "custom" as const,
      verification: "verified_talent",
      confidence: "medium",
      resumeUpload: "available" as const,
      jobAlerts: "available" as const,
      enabled: true,
      checkedAt: "2026-08-12",
    };

    const result = buildRemediatedCatalog([source], [], {
      overrides: {
        "legacy-bank": {
          url: "https://parent.example/search/jobs",
          talentUrl: "https://parent.example/talent",
          adapter: "custom",
          verification: "MERGED_PARENT_CAREERS",
          channel: "모회사/승계 조직 공식 채용 경로",
        },
      },
      rejectedRecommendations: [],
    });

    expect(result.records[0]).toEqual(expect.objectContaining({
      postingUrl: "https://parent.example/search/jobs",
      talentPoolUrl: "https://parent.example/talent",
      verification: "MERGED_PARENT_CAREERS",
      channel: "모회사/승계 조직 공식 채용 경로",
    }));
  });

  it("records a newer official-verification date when the override supplies one", () => {
    const source = {
      masterRow: 438,
      company: "WESCO International",
      id: "audit-row-438",
      postingUrl: "https://careers.smartrecruiters.com/WESCO1",
      talentUrl: null,
      channel: "Official careers",
      adapter: "smartrecruiters" as const,
      verification: "career_only",
      confidence: "medium",
      resumeUpload: "job_only" as const,
      jobAlerts: "unknown" as const,
      enabled: true,
      checkedAt: "2026-08-08",
    };

    const result = buildRemediatedCatalog([source], [], {
      overrides: {
        "audit-row-438": {
          url: "https://eklm.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/jobs",
          adapter: "custom",
          checkedAt: "2026-08-15",
        },
      },
      rejectedRecommendations: [],
    });

    expect(result.records[0]).toEqual(expect.objectContaining({
      postingUrl: "https://eklm.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/jobs",
      checkedAt: "2026-08-15",
    }));
  });
});
