import { describe, expect, it } from "vitest";
import { crawlSource } from "./crawler";
import { isSafeCareerListingUrl } from "./url-remediation";

const now = new Date("2026-09-30T07:00:00Z");
describe("September non-blocked source repairs", () => {
  it("reconciles Oracle's capped global window against official US facets including non-top-ten states", async () => {
    const result = await crawlSource({ id: "audit-row-345", company: "Dollar General", postingUrl: "https://careers.dollargeneral.com/jobs", adapter: "custom" }, async input => {
      const url = new URL(String(input));
      const finder = url.searchParams.get("finder")!;
      if (url.searchParams.get("expand") === "locationsFacet") {
        const term = finder.match(/userTargetFacetInputTerm=([^,]+)/)?.[1];
        const locationsFacet = term ? term === "TX" ? [{ Id: 123, Name: "TX, United States", TotalCount: 201 }] : []
          : [{ Id: 999, Name: "United States", TotalCount: 9801 }];
        return Response.json({ items: [{ TotalJobsCount: 9801, locationsFacet }] });
      }
      const partition = finder.includes("selectedLocationsFacet=123");
      const total = partition ? 201 : 9801;
      const offset = Number(finder.match(/offset=(\d+)/)![1]);
      const page = Array.from({ length: Math.min(200, total - offset) }, (_, n) => ({
        Id: String((partition ? 9601 : 1) + offset + n), Title: "Engineer", PrimaryLocation: "Texas, United States", PrimaryLocationCountry: "US", PostedDate: "2026-09-29",
      }));
      return Response.json({ items: [{ TotalJobsCount: total, requisitionList: page }] });
    }, now);
    expect(result.status).toBe("succeeded");
    expect(result.jobs).toHaveLength(9801);
    expect(result.error).toBeNull();
    expect(result.pagination).toBeUndefined();
    expect(result.completeListing).toBe(false);
  });
  it("uses Dollar General's linked Oracle tenant, preserves the retention margin, and cannot close unseen jobs", async () => {
    const calls: string[] = [];
    const result = await crawlSource({ id: "audit-row-345", company: "Dollar General", postingUrl: "https://careers.dollargeneral.com/jobs?page=1", adapter: "custom" }, async input => {
      const url = new URL(String(input)); calls.push(url.href);
      expect(url.origin).toBe("https://ibxwjb.fa.ocs.oraclecloud.com");
      expect(url.searchParams.get("finder")).toContain("limit=200,offset=0,sortBy=POSTING_DATES_DESC,postingStartDate=2026-08-30");
      return Response.json({ items: [{ TotalJobsCount: 1, requisitionList: [{ Id: "123", Title: "Software Engineer", PrimaryLocation: "Nashville, TN, United States", PostedDate: "2026-09-29" }] }] });
    }, now);
    expect(result.status).toBe("succeeded");
    expect(result.jobs).toHaveLength(1);
    expect(result.completeListing).toBe(false);
    expect(calls).toHaveLength(1);
    expect(isSafeCareerListingUrl("Dollar General", "https://careers.dollargeneral.com/jobs", result.resolvedListingUrl!)).toBe(true);
  });

  it.each(["Masimo", "Other subsidiary"])("pins the Masimo operating company on request and response: %s", async opco => {
    const result = await crawlSource({ id: "p5-0660-masimo", company: "Masimo", postingUrl: "https://egcu.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/", adapter: "custom" }, async (input, init) => {
      expect(String(input)).toBe("https://jobs.danaher.com/widgets");
      expect(JSON.parse(String(init?.body)).selected_fields).toEqual({ opco: ["Masimo"] });
      return Response.json({ refineSearch: { totalHits: 1, hits: 1, data: { jobs: [{ jobId: "R123", title: "Software Engineer", opco, location: "Irvine, CA, United States", postedDate: "2026-09-29", applyUrl: "https://danaher.wd1.myworkdayjobs.com/DanaherJobs/job/Irvine/Engineer_R123/apply" }] } } });
    }, now);
    if (opco === "Masimo") {
      expect(result.status).toBe("succeeded");
      expect(result.jobs[0].officialUrl).toBe("https://jobs.danaher.com/global/en/job/R123/software-engineer");
      expect(result.completeListing).toBe(true);
    } else {
      expect(result.status).toBe("failed");
      expect(result.jobs).toEqual([]);
    }
  });

  it("does not authorize a whole Danaher catalog for Masimo after URL migration", () => {
    const scoped = "https://jobs.danaher.com/global/en/search-results?opco=Masimo";
    expect(isSafeCareerListingUrl("Masimo", "https://egcu.fa.us6.oraclecloud.com/", scoped)).toBe(true);
    expect(isSafeCareerListingUrl("Masimo", scoped, scoped.replace("?opco=Masimo", ""))).toBe(false);
    expect(isSafeCareerListingUrl("Unrelated", "https://example.com/jobs", scoped)).toBe(false);
  });

  const entry = (id: number) => ({ id, title: "Payroll Specialist", description: "<p>Operations role.</p>",
    apply_url: `https://app.careerarc.com/job_postings/${id}?ctm_campaign=job_map%3A401&ctm_company=459&ctm_source=5&ctm_target=job_posting%3A${id}`,
    brand: { id: 2276, name: "Paycom" }, categories: [{ id: 10, name: "Operations" }], employment_type: "Other", is_unmappable: false, remote: false,
    locations: [{ id, canonical_name: "Oklahoma City, OK, US", city: "Oklahoma City", state: "OK", postal_code: "73142", country_code: "USA", lat: 35.55, lng: -97.64 }] });
  it.each([false, true])("reconciles overlapping Paycom pages only against a complete stable map: drift=%s", async drift => {
    let markerReads = 0;
    const result = await crawlSource({ id: "p4-0472-paycom", company: "Paycom", postingUrl: "https://www.paycom.com/careers/job-map/", adapter: "custom" }, async input => {
      const url = new URL(String(input));
      if (url.hostname === "www.paycom.com") return new Response('<iframe src="https://app.careerarc.com/job_maps/401"></iframe>');
      if (url.pathname.endsWith("/markers")) {
        markerReads++;
        return Response.json({ entries: [{ geohash: "9y6dd9u84juu", locations_count: 1, job_postings_count: drift && markerReads > 1 ? 3 : 2,
          bounds: { north: 35.55, south: 35.55, east: -97.64, west: -97.64 } }] });
      }
      return Response.json({ entries: [entry(7000001), entry(url.searchParams.has("geohash") ? 7000002 : 7000001)],
        meta: { total_count: 2, total_pages: 1, page: 1, per_page: 25, links: {} } });
    }, now);
    expect(markerReads).toBe(2);
    expect(result.status).toBe(drift ? "failed" : "succeeded");
    expect(result.completeListing).toBe(!drift);
    expect(result.jobs).toHaveLength(drift ? 0 : 2);
  });
});
