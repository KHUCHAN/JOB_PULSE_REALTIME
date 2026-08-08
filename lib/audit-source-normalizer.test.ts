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
});
