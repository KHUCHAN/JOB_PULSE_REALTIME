import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crawlSource, type CrawlSource, type SourceCrawlResult } from "../lib/crawler.ts";

type CoverageRecord = {
  id: string;
  company: string;
  postingUrl: string;
  adapter: CrawlSource["adapter"];
  status: SourceCrawlResult["status"];
  responseStatus: number | null;
  jobsExtracted: number;
  completeListing: boolean;
  resolvedListingUrl: string | null;
  error: string | null;
  durationMs: number;
  requestCount: number;
};

export type CoverageReport = {
  total: number;
  byStatus: Record<SourceCrawlResult["status"], number>;
  sources: CoverageRecord[];
};

export async function runCoverageAudit(
  sources: CrawlSource[],
  fetcher: typeof fetch,
  options: { concurrency?: number; now?: Date } = {},
): Promise<CoverageReport> {
  const now = options.now ?? new Date();
  const records: CoverageRecord[] = new Array(sources.length);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 8, sources.length));
  let cursor = 0;

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < sources.length) {
      const index = cursor++;
      const source = sources[index];
      let requestCount = 0;
      const startedAt = performance.now();
      const measuredFetch: typeof fetch = async (input, init) => {
        requestCount += 1;
        return fetcher(input, init);
      };
      const result = await crawlSource(source, measuredFetch, now);
      records[index] = {
        id: source.id,
        company: source.company,
        postingUrl: source.postingUrl,
        adapter: source.adapter,
        status: result.status,
        responseStatus: result.responseStatus,
        jobsExtracted: result.jobs.length,
        completeListing: result.completeListing,
        resolvedListingUrl: result.resolvedListingUrl ?? null,
        error: result.error,
        durationMs: Math.round(performance.now() - startedAt),
        requestCount,
      };
    }
  }));

  return {
    total: records.length,
    byStatus: records.reduce((counts, record) => {
      counts[record.status] += 1;
      return counts;
    }, { succeeded: 0, failed: 0, blocked: 0 }),
    sources: records,
  };
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type LiveSource = CrawlSource & { health?: string };

const auditSources = async (): Promise<CrawlSource[]> => {
  const liveUrl = process.env.CRAWLER_AUDIT_LIVE_URL?.trim();
  if (!liveUrl) {
    const seed = JSON.parse(await readFile(resolve(projectRoot, "db/seed/sources.json"), "utf8")) as { sources: Array<CrawlSource & { enabled: boolean }> };
    return seed.sources.filter((source) => source.postingUrl);
  }

  const endpoint = new URL("/api/pulse?resource=sources", liveUrl);
  const response = await fetch(endpoint, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Live source inventory returned HTTP ${response.status}.`);
  const sources = await response.json() as LiveSource[];
  const sourceIds = new Set((process.env.CRAWLER_AUDIT_SOURCE_IDS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean));
  const health = new Set((process.env.CRAWLER_AUDIT_HEALTH ?? "failed,blocked")
    .split(",").map((value) => value.trim()).filter(Boolean));
  const limit = Math.max(1, Number.parseInt(process.env.CRAWLER_AUDIT_LIMIT ?? String(sources.length), 10) || sources.length);
  return sources
    .filter((source) => source.postingUrl
      && (sourceIds.size > 0 ? sourceIds.has(source.id) : !source.health || health.has(source.health)))
    .slice(0, limit);
};

const auditedFetch: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("15 second crawl timeout"), 15_000);
  try {
    const signal = init?.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal;
    return await fetch(input, {
      ...init,
      signal,
      headers: { accept: "application/json, text/html;q=0.9", ...init?.headers },
    });
  } finally {
    clearTimeout(timeout);
  }
};

async function main(): Promise<void> {
  const sources = await auditSources();
  const report = await runCoverageAudit(sources, auditedFetch, { concurrency: 8 });
  const outputDir = resolve(projectRoot, "outputs");
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "crawler-coverage.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    total: report.total,
    byStatus: report.byStatus,
    extractedJobs: report.sources.reduce((sum, source) => sum + source.jobsExtracted, 0),
    requests: report.sources.reduce((sum, source) => sum + source.requestCount, 0),
    slowest: [...report.sources].sort((a, b) => b.durationMs - a.durationMs).slice(0, 20)
      .map(({ id, company, status, durationMs, requestCount, error }) => ({ id, company, status, durationMs, requestCount, error })),
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
