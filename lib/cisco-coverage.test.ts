import { describe, expect, it } from "vitest";
import { crawlSource, US_SCOPED_LARGE_CATALOGS } from "./crawler";

describe("Cisco complete country and internship detail coverage", () => {
  it("keeps the global catalog and hydrates more than eight internships without a recruiting-year gate", async () => {
    const locations = ["San Jose, California, US", "London, United Kingdom", "Singapore, Singapore", "Toronto, Canada"];
    const postings = Array.from({ length: 16 }, (_, i) => ({
      title: `${i % 2 ? "Data Science Intern" : "Software Engineer Co-op"} ${i}`,
      externalPath: `/job/location/Role_${2027000 + i}`,
      locationsText: locations[i % locations.length], postedOn: "Posted Today",
    }));
    let details = 0;
    const result = await crawlSource({
      id: "p4-0245-cisco", company: "Cisco", adapter: "phenom",
      postingUrl: "https://careers.cisco.com/global/en/search-results",
    }, async (input, init) => {
      if (String(input).endsWith("/jobs")) {
        expect(JSON.parse(String(init?.body)).appliedFacets).toEqual({});
        return Response.json({ total: postings.length, jobPostings: postings,
          facets: [{ facetParameter: "Country", values: [{ id: "us-only", descriptor: "United States" }] }],
        });
      }
      details++;
      const i = Number(String(input).match(/_(\d+)$/)?.[1]) - 2027000;
      expect(Number.isInteger(i) && i >= 0 && i < postings.length).toBe(true);
      return Response.json({ jobPostingInfo: {
        title: postings[i].title, jobReqId: String(2027000 + i), startDate: "2026-09-28",
        location: locations[i % locations.length], timeType: "Full time",
        jobDescription: "Build Python and SQL machine learning systems. ".repeat(5),
      } });
    }, new Date("2026-09-29T21:00:00Z"));
    expect(US_SCOPED_LARGE_CATALOGS.has("p4-0245-cisco")).toBe(false);
    expect(result.status).toBe("succeeded");
    // Cisco's checkpoint owner, not a single segment, marks the full drain.
    expect(result.pagination?.cycleComplete).toBe(true);
    expect(result.jobs).toHaveLength(16);
    expect(details).toBe(16);
    expect(new Set(result.jobs.map(j => j.location))).toEqual(new Set(locations));
    for (const job of result.jobs) {
      expect(job.description).toContain("Python and SQL");
      expect(job.requisitionId).toMatch(/^20270/);
      expect(job.publishedAt).toBe("2026-09-28T00:00:00.000Z");
    }
  });
});
