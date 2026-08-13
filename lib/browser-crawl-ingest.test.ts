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

  it("drops non-job UI controls even when their URL resembles a job detail", () => {
    const result = normalizeBrowserJobSnapshot(source, [
      { officialUrl: "https://careers.alvarezandmarsal.com/jobs/123", title: "Create alert" },
      { officialUrl: "https://careers.alvarezandmarsal.com/jobs/124", title: "Get in touch!" },
      { officialUrl: "https://careers.alvarezandmarsal.com/jobs/125", title: "Share Your Information" },
    ]);
    expect(result.jobs).toEqual([]);
  });
});
