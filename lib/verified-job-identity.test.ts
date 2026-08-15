import { describe, expect, it } from "vitest";
import { normalizeBarclaysJobIdentityRepair } from "./verified-job-identity";

const valid = {
  jobId: "job-1",
  officialUrl: "https://search.jobs.barclays/job/new-york/quantitative-finance-associate-summer-internship-program-2027-new-york/13015/99217260160",
  requisitionId: "jr-0000128099",
  applyUrl: "https://barclays.wd3.myworkdayjobs.com/External_Career_Site_Barclays/job/New-York-745-7th-Avenue/Quantitative-Finance-Associate-Summer-Internship-Program-2027-New-York_JR-0000128099/apply",
};

describe("verified Barclays job identity repair", () => {
  it("normalizes an exact first-party TalentBrew and Workday identity pair", () => {
    expect(normalizeBarclaysJobIdentityRepair(valid)).toEqual({
      ...valid,
      requisitionId: "JR-0000128099",
    });
  });

  it.each([
    { ...valid, officialUrl: "https://example.com/job/13015/99217260160" },
    { ...valid, officialUrl: `${valid.officialUrl}?changed=1` },
    { ...valid, requisitionId: "JR-OTHER" },
    { ...valid, applyUrl: valid.applyUrl.replace("barclays.wd3", "attacker.wd3") },
    { ...valid, applyUrl: valid.applyUrl.replace("JR-0000128099", "JR-0000999999") },
  ])("rejects mismatched or non-first-party inputs", (input) => {
    expect(normalizeBarclaysJobIdentityRepair(input)).toBeNull();
  });
});
