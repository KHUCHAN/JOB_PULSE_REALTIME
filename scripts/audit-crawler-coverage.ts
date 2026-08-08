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
  error: string | null;
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
      const result = await crawlSource(source, fetcher, now);
      records[index] = {
        id: source.id,
        company: source.company,
        postingUrl: source.postingUrl,
        adapter: source.adapter,
        status: result.status,
        responseStatus: result.responseStatus,
        jobsExtracted: result.jobs.length,
        completeListing: result.completeListing,
        error: result.error,
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

const auditedFetch: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("15 second crawl timeout"), 15_000);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      headers: { accept: "application/json, text/html;q=0.9", ...init?.headers },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }
};

async function main(): Promise<void> {
  const seed = JSON.parse(await readFile(resolve(projectRoot, "db/seed/sources.json"), "utf8")) as { sources: Array<CrawlSource & { enabled: boolean }> };
  const sources = seed.sources.filter((source) => source.postingUrl);
  const report = await runCoverageAudit(sources, auditedFetch, { concurrency: 8 });
  const outputDir = resolve(projectRoot, "outputs");
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "crawler-coverage.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ total: report.total, byStatus: report.byStatus, extractedJobs: report.sources.reduce((sum, source) => sum + source.jobsExtracted, 0) })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
