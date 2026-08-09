import { describe, expect, it } from "vitest";
import { jobsFromBrowserAnchors } from "./browser-job-extractor";

const source = { id: "acme", company: "Acme", postingUrl: "https://acme.com/careers", adapter: "custom" as const };

describe("jobsFromBrowserAnchors", () => {
  it("keeps official job details and supported ATS details", () => {
    const jobs = jobsFromBrowserAnchors([
      { href: "https://acme.com/careers/jobs/risk-analyst", text: "Senior Risk Analyst" },
      { href: "https://jobs.lever.co/acme/abc-123", text: "Remote Data Engineer" },
      { href: "https://evil.example/jobs/acme", text: "Copied Acme role" },
    ], source);
    expect(jobs.map((job) => job.title)).toEqual(["Senior Risk Analyst", "Remote Data Engineer"]);
    expect(jobs[1].arrangement).toBe("remote");
  });

  it("rejects listing links and generic navigation", () => {
    expect(jobsFromBrowserAnchors([
      { href: "https://acme.com/careers/search-jobs", text: "Search jobs" },
      { href: "https://acme.com/careers/jobs/123", text: "Apply now" },
    ], source)).toEqual([]);
  });
});
