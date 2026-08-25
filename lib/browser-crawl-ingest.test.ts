import { describe, expect, it } from "vitest";
import { normalizeBrowserJobSnapshot } from "./browser-crawl-ingest";

const source = {
  id: "p4-0214-alvarez-marsal",
  company: "Alvarez & Marsal",
  postingUrl: "https://careers.alvarezandmarsal.com/search/jobs",
  adapter: "custom" as const,
};

describe("browser crawl ingestion", () => {
  it("normalizes A&M card metadata into filterable jobs and facets", () => {
    const result = normalizeBrowserJobSnapshot(source, [{
      officialUrl: "https://careers.alvarezandmarsal.com/jobs/18099685-internship-financial-services-industry-m-and-a-london",
      title: "Internship, Financial Services Industry M&A, London",
      location: "London, United Kingdom",
      publishedText: "Aug 10, 2026",
      businessUnit: "ECPR",
      department: "Financial Services",
      jobRequisitionType: "Campus Recruiting",
      employmentType: "Intern",
      postingType: "External",
      region: "UK & Europe",
    }]);

    expect(result.jobs).toEqual([expect.objectContaining({
      externalId: "18099685",
      company: "Alvarez & Marsal",
      employmentType: "Internship",
      department: "Financial Services",
      businessUnit: "ECPR",
      jobFamily: "UK & Europe",
      publishedAt: "2026-08-10T00:00:00.000Z",
    })]);
    expect(result.facets).toEqual(expect.arrayContaining([
      { key: "employment_type", label: "Employment type", values: [{ key: "Internship", label: "Internship", count: 1 }] },
      { key: "region", label: "Region", values: [{ key: "UK & Europe", label: "UK & Europe", count: 1 }] },
      { key: "business_unit", label: "Business unit", values: [{ key: "ECPR", label: "ECPR", count: 1 }] },
    ]));
  });

  it("rejects browser records that point outside the source's official careers origin", () => {
    expect(() => normalizeBrowserJobSnapshot(source, [{
      officialUrl: "https://attacker.example/jobs/1",
      title: "Fake role",
    }])).toThrow(/official careers origin/i);
  });

  it("accepts an explicitly verified redirected ATS origin", () => {
    const result = normalizeBrowserJobSnapshot(source, [{
      officialUrl: "https://jobs.example-ats.com/jobs/REQ-101",
      title: "Data Science Intern",
    }], ["https://jobs.example-ats.com/search"]);

    expect(result.jobs[0]).toEqual(expect.objectContaining({ externalId: "REQ-101" }));
  });

  it("drops an unverified auxiliary apply URL without rejecting the official job", () => {
    const result = normalizeBrowserJobSnapshot(source, [{
      officialUrl: "https://careers.alvarezandmarsal.com/jobs/18099685-data-intern",
      applyUrl: "https://tracking.example/apply/18099685",
      title: "Data Intern",
    }]);

    expect(result.jobs).toEqual([expect.objectContaining({
      externalId: "18099685",
      officialUrl: "https://careers.alvarezandmarsal.com/jobs/18099685-data-intern",
    })]);
    expect(result.jobs[0]).not.toHaveProperty("applyUrl");
  });

  it("strips the visible card labels emitted by the browser fallback", () => {
    const result = normalizeBrowserJobSnapshot(source, [{
      officialUrl: "https://careers.alvarezandmarsal.com/jobs/18109880-microsoft-365-engineer",
      title: "Microsoft 365 Engineer",
      location: "Location: Manchester, United Kingdom",
      publishedText: "Date Posted: Aug 12, 2026",
    }]);

    expect(result.jobs[0]).toEqual(expect.objectContaining({
      location: "Manchester, United Kingdom",
      publishedAt: "2026-08-12T00:00:00.000Z",
    }));
  });

  it("preserves bounded native-runner fields used by filters and job details", () => {
    const result = normalizeBrowserJobSnapshot({
      id: "p5-0722-saic",
      company: "SAIC",
      postingUrl: "https://jobs.saic.com/search/jobs/in/country/united-states",
      adapter: "custom",
    }, [{
      externalId: "18100000",
      officialUrl: "https://jobs.saic.com/jobs/18100000-data-science-intern",
      applyUrl: "https://jobs.saic.com/jobs/18100000-data-science-intern/apply",
      title: "Data Science Intern",
      location: "Reston, VA, United States",
      locationCity: "Reston",
      locationState: "VA",
      locationCountry: "United States",
      arrangement: "onsite",
      employmentType: "Internship",
      summary: "Build production ML systems.",
      description: "A detailed internship description.",
      skills: ["Python", "SQL"],
      department: "Data Science",
      team: "Applied AI",
      requisitionId: "18100000",
      sourcePostedText: "2026-08-15 13:09:58 UTC",
      sourceUpdatedAt: "2026-08-15T13:09:58.000Z",
      publishedAt: "2026-08-15T13:09:58.000Z",
    }]);

    expect(result.jobs[0]).toEqual(expect.objectContaining({
      externalId: "18100000",
      locationCity: "Reston",
      locationState: "VA",
      locationCountry: "United States",
      arrangement: "onsite",
      description: "A detailed internship description.",
      skills: ["Python", "SQL"],
      team: "Applied AI",
      requisitionId: "18100000",
      sourceUpdatedAt: "2026-08-15T13:09:58.000Z",
      publishedAt: "2026-08-15T13:09:58.000Z",
    }));
  });

  it("drops non-job UI controls even when their URL resembles a job detail", () => {
    const result = normalizeBrowserJobSnapshot(source, [
      { officialUrl: "https://careers.alvarezandmarsal.com/jobs/123", title: "Create alert" },
      { officialUrl: "https://careers.alvarezandmarsal.com/jobs/124", title: "Get in touch!" },
      { officialUrl: "https://careers.alvarezandmarsal.com/jobs/125", title: "Share Your Information" },
    ]);
    expect(result.jobs).toEqual([]);
  });

  it("drops Avature navigation links from a rendered SearchJobs snapshot", () => {
    const result = normalizeBrowserJobSnapshot({
      id: "audit-row-342",
      company: "Delta Air Lines",
      postingUrl: "https://delta.avature.net/en_US/careers/SearchJobs/?jobOffset=40",
      adapter: "custom",
    }, [
      { officialUrl: "https://delta.avature.net/en_US/careers/SearchJobs/?jobOffset=50", title: "Next >>" },
      { officialUrl: "https://delta.avature.net/en_US/careers/JobDetail/Data-Science-Intern/7001", title: "Data Science Intern" },
    ]);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toEqual(expect.objectContaining({ externalId: "7001" }));
  });
});
