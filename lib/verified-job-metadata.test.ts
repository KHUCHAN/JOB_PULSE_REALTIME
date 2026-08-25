import { describe, expect, it } from "vitest";
import { normalizeVerifiedJobMetadataRepair } from "./verified-job-metadata";

describe("verified job metadata repair", () => {
  it("normalizes a guarded official-title repair", () => {
    expect(normalizeVerifiedJobMetadataRepair({
      jobId: "job-1",
      officialUrl: "https://jobs.example.com/R-42",
      currentTitle: "Data Analytics Fall Co-op",
      verifiedTitle: "Data Analytics Spring Co-op",
      requisitionId: "R-42",
      sourceUpdatedAt: "2026-08-25T12:00:00Z",
      season: "spring",
    })).toMatchObject({
      jobId: "job-1",
      verifiedTitle: "Data Analytics Spring Co-op",
      requisitionId: "R-42",
      sourceUpdatedAt: "2026-08-25T12:00:00.000Z",
      season: "spring",
    });
  });

  it("rejects unguarded, unchanged, or non-official repairs", () => {
    expect(normalizeVerifiedJobMetadataRepair({ jobId: "job-1" })).toBeNull();
    expect(normalizeVerifiedJobMetadataRepair({
      jobId: "job-1", officialUrl: "javascript:alert(1)", currentTitle: "A", verifiedTitle: "B",
    })).toBeNull();
    expect(normalizeVerifiedJobMetadataRepair({
      jobId: "job-1", officialUrl: "https://e.example/job", currentTitle: "A", verifiedTitle: "A",
    })).toBeNull();
  });
});
