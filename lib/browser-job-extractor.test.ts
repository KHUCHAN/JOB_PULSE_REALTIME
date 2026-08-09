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
      { href: "https://acme.com/careers/open-positions", text: "Your Privacy Choices" },
      { href: "https://acme.com/company/careers/culture", text: "Culture" },
      { href: "https://acme.com/company/careers/benefits", text: "Benefits" },
      { href: "https://acme.com/careers/view-jobs.html", text: "View Open Roles" },
      { href: "https://acme.com/careers/jobs", text: "Find your future" },
      { href: "https://acme.com/company/careers/teams-people.html", text: "Teams & People" },
      { href: "https://acme.com/company/careers/early-career/edge-student-programs.html", text: "Student Programs" },
    ], source)).toEqual([]);
  });

  it("keeps a corporate career detail whose slug carries a requisition id", () => {
    const jobs = jobsFromBrowserAnchors([
      { href: "https://acme.com/company/careers/engineering/staff-engineer-8487325002", text: "Staff Engineer" },
    ], source);

    expect(jobs.map((job) => job.officialUrl)).toEqual([
      "https://acme.com/company/careers/engineering/staff-engineer-8487325002",
    ]);
  });
});
