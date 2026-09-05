import type { CrawledJob } from "./crawler";
import { isExpiredPosting } from "./job-retention.ts";

type SnapshotChunkOptions = {
  maxBytes?: number;
  maxJobs?: number;
};

type SnapshotTransportOptions = SnapshotChunkOptions & {
  allowedOrigins: string[];
  authorization: () => Promise<string>;
  completeListing: boolean;
  endpoint: string;
  fetcher?: typeof fetch;
  jobs: CrawledJob[];
  listingUrl: string;
  sourceId: string;
  attempts?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  /** Apply the same official-publication retention rule before network transfer. */
  retentionNow?: string;
};

export type SnapshotTransportSummary = {
  jobs: number;
  created: number;
  updated: number;
  closed: number;
  chunks: number;
};

type SnapshotIngestPayload = {
  jobs?: number;
  created?: number;
  updated?: number;
  closed?: number;
  error?: string;
};

const boundedText = (value: unknown, max: number): unknown => (
  typeof value === "string" && value.length > max ? value.slice(0, max) : value
);

/**
 * Strip fields the production normalizer never consumes and bound the same
 * text/array fields it accepts. Browser-native adapters sometimes retain a
 * complete upstream payload on every normalized job; forwarding that payload
 * made a single recovery POST exceed 50 MB even though none of it was stored.
 */
export const browserIngestRecord = (job: CrawledJob): Record<string, unknown> => {
  const { rawPayload: _rawPayload, ...record } = job;
  void _rawPayload;
  return {
    ...record,
    summary: boundedText(record.summary, 4_000),
    description: boundedText(record.description, 100_000),
    responsibilities: boundedText(record.responsibilities, 40_000),
    qualifications: boundedText(record.qualifications, 40_000),
    skills: record.skills?.slice(0, 100),
    secondaryLocations: record.secondaryLocations?.slice(0, 100),
    languages: record.languages?.slice(0, 100),
  };
};

export const browserIngestChunks = (
  jobs: CrawledJob[],
  options: SnapshotChunkOptions = {},
): Array<Array<Record<string, unknown>>> => {
  const maxBytes = options.maxBytes ?? 750_000;
  const maxJobs = options.maxJobs ?? 100;
  if (!Number.isInteger(maxBytes) || maxBytes < 32_000) throw new Error("Snapshot chunk byte limit is too small.");
  if (!Number.isInteger(maxJobs) || maxJobs < 1) throw new Error("Snapshot chunk job limit must be positive.");

  const encoder = new TextEncoder();
  const chunks: Array<Array<Record<string, unknown>>> = [];
  let chunk: Array<Record<string, unknown>> = [];
  let chunkBytes = 2;
  for (const job of jobs) {
    const record = browserIngestRecord(job);
    const recordBytes = encoder.encode(JSON.stringify(record)).byteLength;
    if (recordBytes + 2 > maxBytes) throw new Error("A normalized browser job exceeds the snapshot transport limit.");
    const candidateBytes = chunkBytes + recordBytes + (chunk.length > 0 ? 1 : 0);
    if (chunk.length >= maxJobs || candidateBytes > maxBytes) {
      chunks.push(chunk);
      chunk = [];
      chunkBytes = 2;
    }
    chunk.push(record);
    chunkBytes += recordBytes + (chunk.length > 1 ? 1 : 0);
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
};

export const ingestJobSnapshotInChunks = async (
  options: SnapshotTransportOptions,
): Promise<SnapshotTransportSummary> => {
  const fetcher = options.fetcher ?? fetch;
  const attempts = options.attempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 250;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) {
    throw new Error("Snapshot transport attempts must be between 1 and 5.");
  }
  const retained = options.retentionNow
    ? options.jobs.filter(job => !isExpiredPosting(job.publishedAt, options.retentionNow!))
    : options.jobs;
  // An all-expired catalog still needs one bounded transport to record the
  // observation/finalizer. The server rechecks retention and stores none of it.
  const transported = retained.length === 0 && options.jobs.length > 0
    ? options.jobs.slice(0, 1) : retained;
  const chunks = browserIngestChunks(transported, options);
  if (chunks.length === 0) throw new Error("Browser snapshot contained no jobs to transport.");
  const snapshotStartedAt = new Date().toISOString();
  const summary: SnapshotTransportSummary = {
    jobs: 0,
    created: 0,
    updated: 0,
    closed: 0,
    chunks: chunks.length,
  };

  for (let index = 0; index < chunks.length; index += 1) {
    const body = JSON.stringify({
      action: "ingestBrowserJobs",
      sourceId: options.sourceId,
      listingUrl: options.listingUrl,
      jobs: chunks[index],
      allowedOrigins: options.allowedOrigins,
      // Facets derived from one transport chunk are not a complete source
      // snapshot. Preserve the last authoritative facet generation.
      replaceFacets: false,
      snapshotStartedAt,
      // Keep this backwards compatible during a rolling deployment: an old
      // Worker safely ignores finalizeSnapshot while completeListing stays
      // false, instead of closing rows that arrived in earlier chunks.
      completeListing: false,
      finalizeSnapshot: options.completeListing && index === chunks.length - 1,
    });
    let payload: SnapshotIngestPayload | null = null;
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let response: Response;
      try {
        const bearer = await options.authorization();
        response = await fetcher(options.endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Production browser ingest failed.");
        if (attempt === attempts) throw lastError;
        if (retryDelayMs > 0) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelayMs * attempt));
        }
        continue;
      }
      payload = await response.json().catch(() => null) as SnapshotIngestPayload | null;
      if (response.ok) {
        lastError = null;
        break;
      }
      lastError = new Error(`Production ingest returned HTTP ${response.status}${payload?.error ? `: ${payload.error}` : "."}`);
      const retryable = [408, 425, 429].includes(response.status) || response.status >= 500;
      if (!retryable || attempt === attempts) throw lastError;
      if (retryDelayMs > 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelayMs * attempt));
      }
    }
    if (lastError) throw lastError;
    summary.jobs += payload?.jobs ?? chunks[index].length;
    summary.created += payload?.created ?? 0;
    summary.updated += payload?.updated ?? 0;
    summary.closed += payload?.closed ?? 0;
  }
  return summary;
};
