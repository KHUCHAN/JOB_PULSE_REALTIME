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
      { href: "https://acme.com/jobs/search?page=3", text: "Skip to jobs search results" },
      { href: "https://acme.com/careers/positions/filter?location=Denver", text: "View Jobs" },
      { href: "https://acme.com/jobs/search?pr=2", text: "Page 3 of 4" },
      { href: "https://acme.com/jobs/search", text: "Chinese (Simplified)" },
      { href: "https://acme.com/jobs/search", text: "Your Privacy Choices" },
      { href: "https://acme.com/jobs/search", text: "View Finance Opportunities" },
      { href: "https://acme.com/jobs/skip", text: "Skip to main content" },
      { href: "https://acme.com/jobs/open", text: "Search Open Jobs" },
      { href: "https://acme.com/jobs/all", text: "View All Roles" },
      { href: "https://acme.com/jobs/help", text: "Click Here" },
      { href: "https://acme.com/jobs/states", text: "Search All California Jobs" },
      { href: "https://acme.com/careers/programs/explore", text: "Explore Opportunities" },
      { href: "https://acme.com/careers/talent/join", text: "Join Our Talent Community" },
      { href: "https://acme.com/careers/company/benefits", text: "Benefits" },
      { href: "https://login-acme.icims.com/jobs/login?loginOnly=1", text: "here." },
      { href: "https://acme.com/join/talentcommunity/form", text: "Form" },
    ], source)).toEqual([]);
  });

  it("rejects malformed encoded-quote and backslash URLs", () => {
    expect(jobsFromBrowserAnchors([
      { href: "https://jobs.acme.com/%22/jobs/%22", text: "Internal jobs" },
      { href: "https://jobs.acme.com/jobs\\engineering", text: "Engineering jobs" },
    ], { ...source, postingUrl: "https://jobs.acme.com" })).toEqual([]);
  });

  it("keeps a corporate career detail whose slug carries a requisition id", () => {
    const jobs = jobsFromBrowserAnchors([
      { href: "https://acme.com/company/careers/engineering/staff-engineer-8487325002", text: "Staff Engineer" },
    ], source);

    expect(jobs.map((job) => job.officialUrl)).toEqual([
      "https://acme.com/company/careers/engineering/staff-engineer-8487325002",
    ]);
  });

  it("keeps an Ultipro opportunity detail identified by opportunityId", () => {
    const ultipro = { ...source, postingUrl: "https://recruiting.ultipro.com/PEN1024/JobBoard/board" };
    const jobs = jobsFromBrowserAnchors([{
      href: "https://recruiting.ultipro.com/PEN1024/JobBoard/board/OpportunityDetail?opportunityId=1f447539-e5ba-45b5-a973-4b9d59c802d3",
      text: "Financial Coordinator - Tickets",
    }], ultipro);

    expect(jobs).toEqual([expect.objectContaining({
      externalId: "1f447539-e5ba-45b5-a973-4b9d59c802d3",
      title: "Financial Coordinator - Tickets",
    })]);
  });

  it("derives a real title from a detail URL when the anchor is a generic CTA", () => {
    const jobs = jobsFromBrowserAnchors([
      { href: "https://acme.com/careers/openings/data/senior-data-scientist-network-value/", text: "See role" },
      { href: "https://acme.com/about-us/careers/senior-accountant-financial-reporting", text: "View job details" },
      { href: "https://acme.com/jobs/3014/rf-ms-ic-design-engineer/job", text: "View Listing" },
    ], source);

    expect(jobs.map((job) => job.title)).toEqual([
      "Senior Data Scientist Network Value",
      "Senior Accountant Financial Reporting",
      "Rf Ms Ic Design Engineer",
    ]);
  });
});
