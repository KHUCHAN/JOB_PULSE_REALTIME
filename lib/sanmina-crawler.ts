import type { CrawlSource, CrawledJob, SourceCrawlResult } from "./crawler.ts";

export const sanminaListing = "https://sanminacareers.mua.hrdepartment.com/hr/ats/JobSearch/viewAll";
const clean = (html: string): string => html.replace(/<[^>]*>/g, " ")
  .replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export function sanminaPage(html: string, source: CrawlSource) {
  const range = html.match(/Displaying\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)/i);
  const table = html.match(/<table\b[^>]*id=["']jobSearchResultsGrid_table["'][^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!range || !table) throw Error("Sanmina catalog is missing its range or jobs table.");
  const jobs: CrawledJob[] = [];
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
    if (!cells.length) continue;
    const link = cells[0].match(/href=["'](\/hr\/ats\/Posting\/view\/(\d+))["']/i);
    if (!link || cells.length !== 4 || !/^[\w.-]+$/.test(clean(cells[1])) || !clean(cells[0]))
      throw Error("Sanmina returned an unrecognized job row.");
    const location = clean(cells[3]);
    jobs.push({
      externalId: link[2], requisitionId: clean(cells[1]), title: clean(cells[0]), company: source.company,
      location, jobFamily: clean(cells[2]), arrangement: "unknown", employmentType: null,
      summary: null, publishedAt: null, // The listing does not publish a posting date.
      officialUrl: new URL(link[1], sanminaListing).href,
      ...(/\bUSA:/i.test(location) ? { locationCountry: "United States" }
        : /\bUnited Kingdom:/i.test(location) ? { locationCountry: "United Kingdom" }
        : /\bSingapore:/i.test(location) ? { locationCountry: "Singapore" } : {}),
    });
  }
  return { start: Number(range[1]), end: Number(range[2]), total: Number(range[3]), jobs };
}

/** Public Deltek board linked directly by sanmina.com/careers, not the dead DNS host. */
export async function crawlSanmina(source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  const jobs: CrawledJob[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  try {
    for (let page = 1; page <= 30; page++) {
      const response = await fetcher(`${sanminaListing}/jobSearchPaginationExternal_pageSize:100/jobSearchPaginationExternal_page:${page}`, {
        signal: AbortSignal.timeout(15_000), headers: { accept: "text/html" },
      });
      if (!response.ok) throw Error(`Sanmina returned HTTP ${response.status}.`);
      if (response.url && new URL(response.url).hostname !== new URL(sanminaListing).hostname)
        throw Error("Sanmina catalog redirected outside its verified tenant.");
      const parsed = sanminaPage(await response.text(), source);
      total ??= parsed.total;
      if (parsed.total !== total || parsed.start !== jobs.length + 1
        || parsed.end !== jobs.length + parsed.jobs.length || !parsed.jobs.length)
        throw Error("Sanmina catalog changed or repeated a page during pagination.");
      for (const job of parsed.jobs) {
        if (seen.has(job.externalId!)) throw Error("Sanmina catalog repeated a job identity.");
        seen.add(job.externalId!); jobs.push(job);
      }
      if (jobs.length === total) return {
        status: "succeeded", responseStatus: 200, jobs, error: null,
        completeListing: true, resolvedListingUrl: sanminaListing,
      };
    }
    throw Error("Sanmina catalog exceeded its bounded page limit.");
  } catch (error) {
    return { status: "failed", responseStatus: null, jobs: [], completeListing: false,
      error: error instanceof Error ? error.message : String(error) };
  }
}
