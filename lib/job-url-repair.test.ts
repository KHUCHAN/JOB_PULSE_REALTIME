import { describe, expect, it } from "vitest";
import { normalizeJobUrlRepairs } from "./job-url-repair";

describe("normalizeJobUrlRepairs", () => {
  it("accepts bounded same-origin Workday and Oracle canonical URL repairs", () => {
    expect(normalizeJobUrlRepairs([{
      id: "job-1",
      currentUrl: "https://acme.wd1.myworkdayjobs.com/job/Role_R1",
      officialUrl: "https://acme.wd1.myworkdayjobs.com/Careers/job/Role_R1",
    }, {
      id: "job-2",
      currentUrl: "https://acme.fa.us2.oraclecloud.com/en/sites/CX/job/Role/42",
      officialUrl: "https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/42",
    }])).toHaveLength(2);
  });

  it("rejects cross-origin, unchanged, malformed, and unbounded repairs", () => {
    expect(normalizeJobUrlRepairs([{ id: "job", currentUrl: "https://a.example/job", officialUrl: "https://b.example/job" }])).toEqual([]);
    expect(normalizeJobUrlRepairs([{ id: "job", currentUrl: "https://a.example/job", officialUrl: "https://a.example/job" }])).toEqual([]);
    expect(normalizeJobUrlRepairs([{ id: "job", currentUrl: "nope", officialUrl: "also-nope" }])).toEqual([]);
    expect(normalizeJobUrlRepairs(Array.from({ length: 101 }, (_, index) => ({
      id: `job-${index}`,
      currentUrl: `https://a.example/job/${index}`,
      officialUrl: `https://a.example/jobs/${index}`,
    })))).toHaveLength(100);
  });
});
