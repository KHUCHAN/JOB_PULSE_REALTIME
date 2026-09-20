import { describe, expect, it } from "vitest";
import { crawlSource } from "./crawler";
import { isSafeCareerListingUrl, isSafeCareerRecommendation, isPublicAtsCatalogUrl } from "./url-remediation";
import { crawlSanmina, sanminaListing } from "./sanmina-crawler";
import { sourceRecoveryDelay } from "./recovery-policy";

describe("corrupted crawl-root regression", () => {
  it("accepts the Google results catalog but not its individual job details", () => {
    const root = "https://www.google.com/about/careers/applications/jobs/results/";
    expect(isSafeCareerListingUrl("Google / Alphabet", root, root)).toBe(true);
    expect(isSafeCareerRecommendation("Google / Alphabet", root, root)).toBe(true);
    expect(isSafeCareerListingUrl("Google / Alphabet", root, root + "123-data-intern/")).toBe(false);
  });
  it("rejects escaped URLs, internal portals, and deep individual vacancies", () => {
    for (const bad of [
      'https://careers.amd.com/%22https://internal-amd.icims.com/jobs/search?back=none&redirect=search%5C%22',
      "https://internal-amd.icims.com/jobs/search",
      "https://careers.loewshotels.com/job/room-attendant-substitute/new-york-ny/R0087265/",
    ]) {
      expect(isSafeCareerListingUrl("AMD", bad, bad)).toBe(false);
      expect(isSafeCareerRecommendation("AMD", bad, bad)).toBe(false);
      expect(isPublicAtsCatalogUrl(bad)).toBe(false);
    }
    expect(isSafeCareerListingUrl("Loews", "https://careers.loewshotels.com/job/old/a/123/", "https://careers.loewshotels.com/search/")).toBe(true);
    expect(sourceRecoveryDelay("amd", "Career site returned HTTP 404.")).toBeNull();
    expect(sourceRecoveryDelay("loews", "Career site returned HTTP 410.")).toBeNull();
  });
  it("uses AMD's public API and public canonical detail prefix despite a poisoned stored root", async () => {
    const urls: string[] = [];
    const result = await crawlSource({ id: "p5-0793-amd", company: "AMD", adapter: "icims",
      postingUrl: "https://careers.amd.com/%22https://internal-amd.icims.com/jobs/search%22",
    }, async input => {
      urls.push(String(input));
      return Response.json({ totalCount: 1, jobs: [{ data: { slug: "92621", req_id: "92621", title: "Software Engineer",
        full_location: "Austin, Texas, United States", posted_date: "2026-09-19T10:00:00Z", description: "Build software.",
      } }] });
    }, new Date());
    expect(urls.every(u => u.startsWith("https://careers.amd.com/api/jobs?"))).toBe(true);
    expect(result).toMatchObject({ status: "succeeded", resolvedListingUrl: "https://careers.amd.com/jobs",
      jobs: [{ officialUrl: "https://careers.amd.com/jobs/92621", publishedAt: "2026-09-19T10:00:00.000Z" }] });
  });
});

describe("Sanmina public Deltek catalog", () => {
  const source = { id: "legacy-row-860", company: "Sanmina", adapter: "custom" as const, postingUrl: "https://careers.sanmina.com/api/requisitions/search?page=1" };
  const page = (id: number, start: number, total: number) => `Displaying ${start} - ${start} of ${total}
    <table id="jobSearchResultsGrid_table"><tbody><tr>
    <td><a href="/hr/ats/Posting/view/${id}"><span>Data Intern</span></a></td><td>${id}</td>
    <td>IT</td><td>North America USA: CA-San Jose-SV</td></tr></tbody></table>`;
  it("joins verified pages and never invents publication dates", async () => {
    let n = 0;
    const result = await crawlSanmina(source, async () => new Response(page(100 + ++n, n, 2)));
    expect(result).toMatchObject({ status: "succeeded", completeListing: true, resolvedListingUrl: sanminaListing });
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toMatchObject({ locationCountry: "United States", publishedAt: null, requisitionId: "101" });
    expect(isSafeCareerListingUrl(source.company, source.postingUrl, sanminaListing)).toBe(true);
  });
  it("preserves requisition revisions distinct from the posting URL id", async () => {
    const result = await crawlSanmina(source, async () => new Response(page(98224, 1, 1).replace("<td>98224</td>", "<td>98224.1</td>")));
    expect(result.jobs[0]).toMatchObject({ externalId: "98224", requisitionId: "98224.1" });
  });
  it("fails closed on repeat pages, malformed shells, and unstable totals", async () => {
    for (const fetcher of [
      async () => new Response(page(101, 1, 2)),
      async () => new Response("<html>loading...</html>"),
      (() => { let n = 0; return async () => new Response(page(100 + ++n, n, n + 2)); })(),
    ]) expect(await crawlSanmina(source, fetcher)).toMatchObject({ status: "failed", completeListing: false, jobs: [] });
  });
});
