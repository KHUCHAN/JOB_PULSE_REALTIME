import { describe, expect, it } from "vitest";
import { normalizeAuditRecord } from "./audit-source-normalizer";

describe("normalizeAuditRecord", () => {
  it("maps a verified audit row into a stable public source record", () => {
    expect(normalizeAuditRecord({
      masterRow: 201,
      Company: "Guidehouse",
      "Ledger ID": "P1-0005-guidehouse",
      postingUrl: "https://guidehouse.com/careers",
      talentPoolUrl: "https://guidehouse.wd1.myworkdayjobs.com/en-US/External/introduceYourself",
      channel: "official Talent Community",
      resumeUpload: "미확인",
      jobAlerts: "가능",
      verification: "VERIFIED_TALENT",
      confidence: "HIGH",
      recommendedAction: "SUBMIT_NOW",
      evidenceUrl: "https://guidehouse.wd1.myworkdayjobs.com/en-US/External/introduceYourself",
      evidenceNote: "verified",
      checkedAt: "2026-08-08",
    })).toEqual(expect.objectContaining({
      id: "p1-0005-guidehouse",
      company: "Guidehouse",
      postingUrl: "https://guidehouse.com/careers",
      talentUrl: "https://guidehouse.wd1.myworkdayjobs.com/en-US/External/introduceYourself",
      verification: "verified_talent",
      resumeUpload: "unknown",
      jobAlerts: "available",
      enabled: true,
    }));
  });

  it("uses a deterministic row id and preserves null Talent URLs", () => {
    const normalized = normalizeAuditRecord({
      masterRow: 366,
      Company: "GXO Logistics",
      "Ledger ID": null,
      postingUrl: "https://jobs.gxo.com/",
      talentPoolUrl: null,
      channel: "official careers",
      resumeUpload: "지원 시 가능",
      jobAlerts: "미확인",
      verification: "CAREER_ONLY",
      confidence: "MEDIUM",
      recommendedAction: "CAREER_ONLY",
      evidenceUrl: "https://jobs.gxo.com/",
      evidenceNote: "verified",
      checkedAt: "2026-08-08",
    });

    expect(normalized.id).toBe("audit-row-366");
    expect(normalized.talentUrl).toBeNull();
    expect(normalized.resumeUpload).toBe("job_only");
  });

  it("classifies Ashby job boards for API crawling", () => {
    const normalized = normalizeAuditRecord({
      masterRow: 900,
      Company: "Ashby Example",
      "Ledger ID": "p5-0900-ashby-example",
      postingUrl: "https://jobs.ashbyhq.com/ashby-example",
      talentPoolUrl: null,
      channel: "official careers",
      resumeUpload: "지원 시 가능",
      jobAlerts: "미확인",
      verification: "CAREER_ONLY",
      confidence: "HIGH",
      recommendedAction: "CAREER_ONLY",
      evidenceUrl: "https://jobs.ashbyhq.com/ashby-example",
      evidenceNote: "verified",
      checkedAt: "2026-08-09",
      adapter: "custom",
    });

    expect(normalized.adapter).toBe("ashby");
  });

  it("classifies official Dayforce boards for the native search API", () => {
    const normalized = normalizeAuditRecord({
      masterRow: 903,
      Company: "Dayforce Example",
      "Ledger ID": "p5-0903-dayforce-example",
      postingUrl: "https://jobs.dayforcehcm.com/en-US/example/CANDIDATEPORTAL",
      talentPoolUrl: null,
      channel: "official careers",
      resumeUpload: "미확인",
      jobAlerts: "미확인",
      verification: "CAREER_ONLY",
      confidence: "HIGH",
      recommendedAction: "CAREER_ONLY",
      evidenceUrl: "https://jobs.dayforcehcm.com/en-US/example/CANDIDATEPORTAL",
      evidenceNote: "verified",
      checkedAt: "2026-08-14",
      adapter: "custom",
    });

    expect(normalized.adapter).toBe("dayforce");
  });

  it("promotes SmartRecruiters boards even when the imported adapter is stale", () => {
    const normalized = normalizeAuditRecord({
      masterRow: 904,
      Company: "SmartRecruiters Example",
      "Ledger ID": "p5-0904-smartrecruiters-example",
      postingUrl: "https://careers.smartrecruiters.com/SmartRecruitersExample",
      talentPoolUrl: null,
      channel: "official careers",
      resumeUpload: "미확인",
      jobAlerts: "미확인",
      verification: "CAREER_ONLY",
      confidence: "HIGH",
      recommendedAction: "CAREER_ONLY",
      evidenceUrl: "https://careers.smartrecruiters.com/SmartRecruitersExample",
      evidenceNote: "verified",
      checkedAt: "2026-08-14",
      adapter: "workday",
    });

    expect(normalized.adapter).toBe("smartrecruiters");
  });

  it("does not classify a company careers page from an unrelated Talent form host", () => {
    const normalized = normalizeAuditRecord({
      masterRow: 901,
      Company: "Talent Form Example",
      "Ledger ID": "p5-0901-talent-form-example",
      postingUrl: "https://example.com/careers",
      talentPoolUrl: "https://jobs.ashbyhq.com/example/form/talent-community",
      channel: "official Talent Community",
      resumeUpload: "가능",
      jobAlerts: "가능",
      verification: "VERIFIED_TALENT",
      confidence: "HIGH",
      recommendedAction: "SUBMIT_NOW",
      evidenceUrl: "https://jobs.ashbyhq.com/example/form/talent-community",
      evidenceNote: "verified",
      checkedAt: "2026-08-09",
      adapter: "custom",
    });

    expect(normalized.adapter).toBe("custom");
  });

  it("does not confuse a company name ending in lever with the Lever ATS hostname", () => {
    const normalized = normalizeAuditRecord({
      masterRow: 902,
      Company: "Unilever",
      "Ledger ID": "p5-0759-unilever",
      postingUrl: "https://careers.unilever.com/search-jobs",
      talentPoolUrl: null,
      channel: "official careers",
      resumeUpload: "미확인",
      jobAlerts: "미확인",
      verification: "CAREER_ONLY",
      confidence: "HIGH",
      recommendedAction: "CAREER_ONLY",
      evidenceUrl: "https://careers.unilever.com/search-jobs",
      evidenceNote: "verified",
      checkedAt: "2026-08-11",
      adapter: "custom",
    });

    expect(normalized.adapter).toBe("custom");
  });
});
