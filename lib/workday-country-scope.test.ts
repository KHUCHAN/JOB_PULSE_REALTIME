import { expect, it } from "vitest";
import { crawlSource } from "./crawler";

it.each(["locationHierarchy1", "Country", "locationCountry"])("uses official %s country facet before pagination", async (key) => {
  const bodies: Array<{ appliedFacets: Record<string, string[]> }> = [];
  const card = { title: "Software Engineer", externalPath: "/job/US-CA/Engineer_JR123", locationsText: "US, CA", postedOn: "Posted Today" };
  const fetcher = (async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    return Response.json(body.appliedFacets[key]
      ? { total: 1, jobPostings: [card] }
      : { total: 2000, jobPostings: [card], facets: [{ facetParameter: "group", values: [{ facetParameter: key, values: [{ descriptor: "United States", id: "official-us-id", count: 1 }] }] }] });
  }) as typeof fetch;
  const result = await crawlSource({ id: "p4-0319-nvidia", company: "Nvidia", postingUrl: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite", adapter: "workday" }, fetcher, new Date("2026-09-04T00:00:00Z"));
  expect(result.status).toBe("succeeded");
  expect(bodies.some(body => body.appliedFacets[key]?.[0] === "official-us-id")).toBe(true);
  expect(result.jobs[0].locationCountry).toBe("United States");
  expect(result.completeListing).toBe(true);
});
