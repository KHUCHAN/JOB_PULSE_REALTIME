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
});
