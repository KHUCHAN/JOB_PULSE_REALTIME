import { describe, expect, it } from "vitest";
import { careerCandidates, detectUrlAdapter, isSafeCareerRecommendation, rankCareerLink } from "./url-remediation";

describe("career URL remediation", () => {
  it("prefers a public ATS job board over talent-only and social links", () => {
    const links = [
      { href: "https://linkedin.com/company/acme", text: "LinkedIn" },
      { href: "https://jobs.acme.com/us/en/jointalentcommunity", text: "Join talent community" },
      { href: "https://jobs.acme.com/us/en/search-results", text: "Search jobs" },
    ];
    expect(careerCandidates(links, "https://acme.com/careers")[0].href).toBe("https://jobs.acme.com/us/en/search-results");
  });

  it("ranks official ATS links highly", () => {
    expect(rankCareerLink({ href: "https://jobs.lever.co/acme", text: "Open roles" }, "https://acme.com/careers")).toBeGreaterThan(100);
  });

  it("detects Phenom from loaded resources", () => {
    expect(detectUrlAdapter("https://careers.acme.com/search-results", ["https://cdn.phenompeople.com/app.js"])).toBe("phenom");
  });

  it("rejects individual job detail pages as catalog URLs", () => {
    const detail = { href: "https://careers.example/jobs/staff-engineer-123", text: "Staff Engineer" };
    expect(careerCandidates([detail], "https://careers.example/jobs/search")).toEqual([]);
  });

  it("accepts company-related official career domains and rejects unrelated articles", () => {
    expect(isSafeCareerRecommendation("RTX", "https://rtx.com/careers", "https://careers.rtx.com/global/en")).toBe(true);
    expect(isSafeCareerRecommendation("Live Nation", "https://livenationentertainment.com/careers", "https://rankings.newsweek.com/job-starters")).toBe(false);
  });

  it("rejects career-area and job-cart pages", () => {
    expect(isSafeCareerRecommendation("Caterpillar", "https://caterpillar.com/careers", "https://careers.caterpillar.com/en/career-areas/")).toBe(false);
    expect(isSafeCareerRecommendation("Ascension", "https://jobs.ascension.org", "https://jobs.ascension.org/us/en/jobcart")).toBe(false);
  });
});
