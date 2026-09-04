import type { CrawlSource, SourceCrawlResult } from "./crawler.ts";

type CrawlFunction = (
  source: CrawlSource,
  fetcher: typeof fetch,
  now: Date,
) => Promise<SourceCrawlResult>;

type CheckpointRecoveryOptions = {
  maxPasses?: number;
  maxStalls?: number;
  stallDelayMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
};

const defaultWait = (milliseconds: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

const REQUEST_RECOVERY_DUE_HORIZON_MS = 5 * 60 * 1_000;

export const isRequestFallbackDue = (
  nextRunAt: string | null | undefined,
  now = new Date(),
  force = false,
): boolean => {
  if (force) return true;
  if (!nextRunAt) return true;
  const scheduledTime = Date.parse(nextRunAt);
  if (!Number.isFinite(scheduledTime)) return true;
  return scheduledTime <= now.getTime() + REQUEST_RECOVERY_DUE_HORIZON_MS;
};

/**
 * Drain a checkpointed source inside an independent request runner. The
 * production Worker keeps each pass deliberately short; a fresh GitHub runner
 * can safely join those bounded windows before submitting one baseline
 * snapshot. The snapshot stays non-authoritative so this recovery path cannot
 * close jobs when page ordering changes between windows.
 */
export const recoverCheckpointedCatalog = async (
  source: CrawlSource,
  fetcher: typeof fetch,
  crawl: CrawlFunction,
  options: CheckpointRecoveryOptions = {},
): Promise<SourceCrawlResult> => {
  const jobs = new Map<string, SourceCrawlResult["jobs"][number]>();
  const maxPasses = options.maxPasses ?? 20;
  const maxStalls = options.maxStalls ?? 1;
  const stallDelayMs = options.stallDelayMs ?? 65_000;
  const wait = options.wait ?? defaultWait;
  let cursor = 1;
  let totalPages: number | null = null;
  let stalls = 0;
  let lastResult: SourceCrawlResult | null = null;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const result = await crawl({ ...source, crawlPageCursor: cursor }, fetcher, new Date());
    lastResult = result;
    if (result.status !== "succeeded" || result.jobs.length === 0) {
      if (stalls < maxStalls) {
        stalls += 1;
        await wait(stallDelayMs);
        continue;
      }
      throw new Error(result.error ?? `${result.status} checkpoint result with ${result.jobs.length} jobs.`);
    }
    for (const job of result.jobs) jobs.set(job.externalId ?? job.officialUrl, job);
    if (!result.pagination) return { ...result, jobs: [...jobs.values()] };
    if (totalPages == null) totalPages = result.pagination.totalPages;
    if (result.pagination.totalPages !== totalPages) {
      throw new Error("Checkpointed catalog page count changed during request recovery.");
    }
    if (result.pagination.cycleComplete) {
      return {
        ...result,
        completeListing: false,
        jobs: [...jobs.values()],
        pagination: undefined,
        error: null,
      };
    }
    // Some large Workday tenants return a valid final tail window while page
    // one changes during that same pass. Their adapter conservatively reports
    // nextPage=1 with cycleComplete=false so the snapshot cannot close jobs.
    // The request runner is non-authoritative anyway; once the cursor is in
    // the bounded tail window, retain the collected rows and finish without
    // turning a harmless head-page drift into a permanent stale source.
    if (result.pagination.nextPage === 1
      && cursor > 1
      && cursor >= Math.max(1, result.pagination.totalPages - 40)) {
      return {
        ...result,
        completeListing: false,
        jobs: [...jobs.values()],
        pagination: undefined,
        error: null,
      };
    }
    if (result.pagination.nextPage <= cursor) {
      if (stalls < maxStalls) {
        stalls += 1;
        await wait(stallDelayMs);
        continue;
      }
      throw new Error(`Checkpointed catalog did not advance beyond page ${cursor}.`);
    }
    cursor = result.pagination.nextPage;
    stalls = 0;
  }

  throw new Error(lastResult?.error ?? `Checkpointed catalog exceeded ${maxPasses} recovery passes.`);
};
