import type { CrawledJob } from "./crawler.ts";
import { isExpiredPosting } from "./job-retention.ts";

const canonical = (value: string): string => {
  const url = new URL(value);
  return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/apply\/?$/, "").replace(/\/$/, "").toLowerCase()}`;
};

/** Bounded exact read-after-write identity check, not a full coverage claim. */
export async function verifySourceSnapshot(
  siteUrl: string, sourceId: string, jobs: CrawledJob[], fetcher: typeof fetch = fetch,
): Promise<number> {
  const now = new Date().toISOString();
  jobs = jobs.filter((job) => !isExpiredPosting(job.publishedAt, now));
  const programs = jobs.filter((job) => /\bintern(?:ship)?\b|co[ -]?op/i.test(job.title));
  const selected = [programs[0], programs.at(-1), jobs[0], jobs[Math.floor(jobs.length / 2)], jobs.at(-1)]
    .filter((job): job is CrawledJob => Boolean(job));
  const samples = [...new Map(selected.map((job) => [canonical(job.officialUrl), job])).values()];
  let verified = 0;
  for (const job of samples) {
    const endpoint = new URL("/api/pulse", siteUrl);
    endpoint.search = new URLSearchParams({ resource: "job", sourceId, officialUrl: job.officialUrl }).toString();
    if (job.requisitionId) endpoint.searchParams.set("requisitionId", job.requisitionId);
    if (job.externalId) endpoint.searchParams.set("externalId", job.externalId);
    const response = await fetcher(endpoint, { signal: AbortSignal.timeout(20_000) });
    if (response.status === 410) {
      const archived = await response.json() as { reason?: string; sourceId?: string; officialUrl?: string };
      if (archived.reason === "expired_posting_retention" && archived.sourceId === sourceId && archived.officialUrl === job.officialUrl) continue;
      throw new Error(`Unverified retention response for ${sourceId}: ${job.officialUrl}`);
    }
    if (!response.ok) throw new Error(`DB verification for ${sourceId} returned HTTP ${response.status}: ${job.officialUrl}`);
    const row = await response.json() as { officialUrl?: string; sourceId?: string } | null;
    if (!row?.officialUrl || row.sourceId !== sourceId || canonical(row.officialUrl) !== canonical(job.officialUrl)) {
      throw new Error(`Official sample missing from open DB view: ${sourceId}: ${job.officialUrl}`);
    }
    verified += 1;
  }
  return verified;
}
