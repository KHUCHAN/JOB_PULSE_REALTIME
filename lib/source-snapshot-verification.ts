import type { CrawledJob } from "./crawler.ts";

const canonical = (value: string): string => {
  const url = new URL(value);
  return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/apply\/?$/, "").replace(/\/$/, "").toLowerCase()}`;
};

/** Bounded exact read-after-write identity check, not a full coverage claim. */
export async function verifySourceSnapshot(
  siteUrl: string, sourceId: string, jobs: CrawledJob[], fetcher: typeof fetch = fetch,
): Promise<number> {
  const programs = jobs.filter((job) => /\bintern(?:ship)?\b|co[ -]?op/i.test(job.title));
  const selected = [programs[0], programs.at(-1), jobs[0], jobs[Math.floor(jobs.length / 2)], jobs.at(-1)]
    .filter((job): job is CrawledJob => Boolean(job));
  const samples = [...new Map(selected.map((job) => [canonical(job.officialUrl), job])).values()];
  for (const job of samples) {
    const endpoint = new URL("/api/pulse", siteUrl);
    endpoint.search = new URLSearchParams({ resource: "job", sourceId, officialUrl: job.officialUrl }).toString();
    const response = await fetcher(endpoint, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`DB verification for ${sourceId} returned HTTP ${response.status}: ${job.officialUrl}`);
    const row = await response.json() as { officialUrl?: string; sourceId?: string } | null;
    if (!row?.officialUrl || row.sourceId !== sourceId || canonical(row.officialUrl) !== canonical(job.officialUrl)) {
      throw new Error(`Official sample missing from open DB view: ${sourceId}: ${job.officialUrl}`);
    }
  }
  return samples.length;
}
