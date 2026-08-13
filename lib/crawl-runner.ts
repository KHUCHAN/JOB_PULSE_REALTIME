import { crawlSource, type CrawledFacet, type CrawledJob, type CrawlSource } from "./crawler";
import { detectUrlAdapter } from "./url-remediation";

export type PersistedSource = CrawlSource & {
  nextCrawlAt: string | null;
};

export interface CrawlStore {
  dueSources(now: string, limit: number): Promise<PersistedSource[]>;
  startRun(source: PersistedSource, scheduledFor: string): Promise<string>;
  syncJobs(
    sourceId: string,
    jobs: CrawledJob[],
    completeListing: boolean,
    facets?: CrawledFacet[],
    options?: { suppressNotifications?: boolean },
  ): Promise<{ created: number; updated: number; closed: number }>;
  advancePagedCrawl(
    sourceId: string,
    pagination: { nextPage: number; cycleComplete: boolean; totalPages: number },
    cycleStartedAt: string,
    previousCycleStartedAt: string | null,
  ): Promise<{ closed: number }>;
  updateResolvedListing(sourceId: string, previousUrl: string, postingUrl: string, adapter: CrawlSource["adapter"]): Promise<void>;
  finishRun(runId: string, values: Record<string, unknown>): Promise<void>;
  scheduleNext(sourceId: string, nextCrawlAt: string): Promise<void>;
}

export type CrawlBatchResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  blocked: number;
  created: number;
  updated: number;
  closed: number;
};

const emptyResult = (): CrawlBatchResult => ({ attempted: 0, succeeded: 0, failed: 0, blocked: 0, created: 0, updated: 0, closed: 0 });

const nextCrawlAtForStatus = (now: Date, status: "succeeded" | "failed" | "blocked"): string => {
  const hours = status === "succeeded" ? 2 : status === "failed" ? 6 : 24;
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
};

const runSource = async (
  store: CrawlStore,
  source: PersistedSource,
  fetcher: typeof fetch,
  now: Date,
): Promise<CrawlBatchResult> => {
  const scheduledFor = now.toISOString();
  const runId = await store.startRun(source, scheduledFor);
  const crawl = await crawlSource(source, fetcher, now);
  const result = emptyResult();
  result.attempted = 1;

  let status = crawl.status;
  let error = crawl.error;
  let changes = { created: 0, updated: 0, closed: 0 };
  if (crawl.status === "succeeded") {
    try {
      // A checkpointed feed is initially walked over several invocations. Every
      // page in that first catalog pass is existing inventory, not a newly
      // published role; alert only after the first complete authoritative cycle.
      const suppressInitialCatalogNotifications = Boolean(
        crawl.pagination && source.crawlPreviousCycleStartedAt == null,
      );
      changes = await store.syncJobs(
        source.id,
        crawl.jobs,
        crawl.completeListing,
        crawl.facets,
        { suppressNotifications: suppressInitialCatalogNotifications },
      );
      if (crawl.pagination) {
        const paged = await store.advancePagedCrawl(
          source.id,
          crawl.pagination,
          source.crawlCycleStartedAt ?? scheduledFor,
          source.crawlPreviousCycleStartedAt ?? null,
        );
        changes.closed += paged.closed;
      }
      if (crawl.resolvedListingUrl && crawl.resolvedListingUrl !== source.postingUrl) {
        await store.updateResolvedListing(
          source.id,
          source.postingUrl,
          crawl.resolvedListingUrl,
          detectUrlAdapter(crawl.resolvedListingUrl),
        );
      }
    } catch (syncError) {
      status = "failed";
      error = syncError instanceof Error ? syncError.message : "Could not persist crawl results.";
    }
  }

  result[status] += 1;
  result.created += changes.created;
  result.updated += changes.updated;
  result.closed += changes.closed;
  await store.finishRun(runId, {
    status,
    responseStatus: crawl.responseStatus,
    jobsSeen: crawl.jobs.length,
    jobsCreated: changes.created,
    jobsUpdated: changes.updated,
    jobsClosed: changes.closed,
    error,
    finishedAt: new Date().toISOString(),
  });
  await store.scheduleNext(source.id, nextCrawlAtForStatus(now, status));

  return result;
};

const add = (target: CrawlBatchResult, value: CrawlBatchResult): void => {
  target.attempted += value.attempted;
  target.succeeded += value.succeeded;
  target.failed += value.failed;
  target.blocked += value.blocked;
  target.created += value.created;
  target.updated += value.updated;
  target.closed += value.closed;
};

export async function runDueCrawls(
  store: CrawlStore,
  fetcher: typeof fetch,
  now: Date,
  options: { concurrency?: number; limit?: number } = {},
): Promise<CrawlBatchResult> {
  const sources = await store.dueSources(now.toISOString(), options.limit ?? 500);
  return runSpecificCrawls(store, sources, fetcher, now, options);
}

export async function runSpecificCrawls(
  store: CrawlStore,
  sources: PersistedSource[],
  fetcher: typeof fetch,
  now: Date,
  options: { concurrency?: number } = {},
): Promise<CrawlBatchResult> {
  const result = emptyResult();
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(options.concurrency ?? 8, sources.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < sources.length) {
      const source = sources[cursor++];
      add(result, await runSource(store, source, fetcher, now));
    }
  }));

  return result;
}
