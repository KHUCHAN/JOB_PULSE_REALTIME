import { crawlSource, type CrawlSource } from "../lib/crawler.ts";
import { ingestJobSnapshotInChunks } from "../lib/job-snapshot-transport.ts";
import { isRequestFallbackDue, recoverCheckpointedCatalog } from "../lib/request-fallback-recovery.ts";
import { isSafeCareerListingUrl } from "../lib/url-remediation.ts";
import { verifySourceSnapshot } from "../lib/source-snapshot-verification.ts";
import { deferRecovery } from "../lib/recovery-policy.ts";
import { createFifoLimiter } from "../lib/fifo-limiter.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type LiveSource = {
  id: string;
  company: string;
  postingUrl: string | null;
  adapter: CrawlSource["adapter"];
  nextRunAt: string | null;
  currentJobs?: number;
};

type RecoverySummary = {
  sourceId: string;
  status: "succeeded" | "failed";
  jobs: number;
  created: number;
  updated: number;
  elapsedMs: number;
  error: string | null;
  verifiedDbSamples?: number;
  fetchMs?: number;
  ingestWaitMs?: number;
  ingestMs?: number;
  verifyMs?: number;
};

const siteUrl = (process.env.REQUEST_FALLBACK_LIVE_URL
  ?? "https://job-pulse-realtime.autodev61.chatgpt.site").replace(/\/$/, "");
const ingestUrl = process.env.REQUEST_FALLBACK_INGEST_URL?.trim() || `${siteUrl}/api/pulse`;
const sourceIds = [...new Set((process.env.REQUEST_FALLBACK_SOURCE_IDS ?? "legacy-row-826,p2-0075-american-family-insurance")
  .split(",").map((value) => value.trim()).filter(Boolean))].slice(0, 64);
const forcedSourceIds = new Set((process.env.REQUEST_FALLBACK_FORCE_SOURCE_IDS ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean));
const concurrency = Math.max(1, Math.min(8,
  Number.parseInt(process.env.REQUEST_FALLBACK_CONCURRENCY ?? "4", 10) || 4));
const ingestConcurrency = Math.max(1, Math.min(4,
  Number.parseInt(process.env.REQUEST_FALLBACK_INGEST_CONCURRENCY ?? "2", 10) || 2));
let cachedOidc = { value: "", expiresAt: 0 };
const withIngestSlot = createFifoLimiter(ingestConcurrency);

const githubOidcToken = async (): Promise<string> => {
  const staticSecret = process.env.REQUEST_FALLBACK_INGEST_SECRET?.trim();
  if (staticSecret) return staticSecret;
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) throw new Error("GitHub Actions OIDC is unavailable.");
  if (cachedOidc.value && cachedOidc.expiresAt > Date.now() + 60_000) return cachedOidc.value;
  const endpoint = new URL(requestUrl);
  endpoint.searchParams.set("audience", "job-pulse-realtime");
  const response = await fetch(endpoint, {
    headers: { authorization: `Bearer ${requestToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub Actions OIDC returned HTTP ${response.status}.`);
  const payload = await response.json() as { value?: unknown };
  if (typeof payload.value !== "string" || !payload.value) throw new Error("GitHub Actions OIDC token was missing.");
  const claims = JSON.parse(Buffer.from(payload.value.split(".")[1], "base64url").toString("utf8")) as { exp?: unknown };
  if (typeof claims.exp !== "number") throw new Error("GitHub Actions OIDC token expiry was missing.");
  cachedOidc = { value: payload.value, expiresAt: claims.exp * 1_000 };
  return payload.value;
};

const liveSources = async (): Promise<CrawlSource[]> => {
  if (sourceIds.length === 0) throw new Error("At least one request-fallback source ID is required.");
  // The full source-health view joins every historical crawl run. Request
  // recovery needs only this small explicit set, so keep startup independent
  // of the size of production history.
  // Read in 20-ID windows as well as accepting the newer wider API limit. A
  // workflow can begin while a just-pushed Sites version is still publishing;
  // this keeps the runner compatible with either side of that deployment
  // boundary instead of mistaking the omitted tail for missing sources.
  const sourceWindows = Array.from(
    { length: Math.ceil(sourceIds.length / 20) },
    (_, index) => sourceIds.slice(index * 20, index * 20 + 20),
  );
  const inventory = (await Promise.all(sourceWindows.map(async (window) => {
    const response = await fetch(`${siteUrl}/api/pulse?resource=sources&ids=${encodeURIComponent(window.join(","))}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Live source inventory returned HTTP ${response.status}.`);
    return response.json() as Promise<LiveSource[]>;
  }))).flat();
  const byId = new Map(inventory.map((source) => [source.id, source]));
  const now = new Date();
  // Start large catalogs early so they overlap the many short fetches instead
  // of becoming a serial tail. This does not increase D1 writer concurrency.
  return [...sourceIds].sort((a, b) => (byId.get(b)?.currentJobs ?? 0) - (byId.get(a)?.currentJobs ?? 0)).flatMap((sourceId): CrawlSource[] => {
    const source = byId.get(sourceId);
    if (!source?.postingUrl) throw new Error(`Request-fallback source ${sourceId} is unavailable.`);
    if (!isRequestFallbackDue(source.nextRunAt, now, forcedSourceIds.has(source.id))) return [];
    return [{
      id: source.id,
      company: source.company,
      postingUrl: source.postingUrl,
      adapter: source.adapter,
      ...(source.id === "p4-0394-amazon" ? { requestPageWindow: 12 } : {}),
    }];
  });
};

const recover = async (source: CrawlSource): Promise<RecoverySummary> => {
  const startedAt = Date.now();
  try {
    // The independent Node.js runner has a much larger execution envelope
    // than one Sites Worker request. Drain every paged official catalog here;
    // non-paged sources return immediately from the same helper. This avoids
    // repeatedly ingesting page one for a newly promoted priority source.
    let result: Awaited<ReturnType<typeof recoverCheckpointedCatalog>>;
    // Jacobs publishes more than 7,000 official identities. Its adapter already
    // returns one safely rotating sitemap segment plus a bounded Jobsyn window.
    // Replaying the entire sitemap on every checkpoint pass used to consume the
    // remainder of this job after all priority employers had finished. Persist
    // exactly one non-authoritative segment per two-hour run; the native cursor
    // and deterministic production slot cover the remaining segments over time.
    const recoveryOptions = source.id === "legacy-row-102"
      ? { maxPasses: 1, maxStalls: 0, retainPartialAtPassLimit: true }
      : { maxPasses: 60, maxStalls: 2, stallDelayMs: 1_500 };
    try {
      result = await recoverCheckpointedCatalog(source, fetch, crawlSource, recoveryOptions);
    } catch (firstError) {
      if (deferRecovery(firstError instanceof Error ? firstError.message : "")) throw firstError;
      // Retry the complete source once. Official Workday and sitemap edges can
      // change a page count or reject one burst even though the next bounded
      // pass is healthy; isolating the retry here prevents that source from
      // affecting the other seven worker lanes.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      try {
        result = await recoverCheckpointedCatalog(source, fetch, crawlSource, recoveryOptions);
      } catch (secondError) {
        const firstMessage = firstError instanceof Error ? firstError.message : "unknown first attempt";
        const secondMessage = secondError instanceof Error ? secondError.message : "unknown retry";
        throw new Error(`${firstMessage}; retry: ${secondMessage}`);
      }
    }
    if (result.status !== "succeeded" || result.jobs.length === 0) {
      throw new Error(result.error ?? `${result.status} crawler result with ${result.jobs.length} jobs.`);
    }
    const listingUrl = result.resolvedListingUrl ?? source.postingUrl;
    if (!isSafeCareerListingUrl(source.company, source.postingUrl, listingUrl)) {
      throw new Error("Crawler resolved an unsafe listing URL.");
    }
    const allowedOrigins = [listingUrl, ...result.jobs.flatMap((job) => [job.officialUrl, job.applyUrl ?? ""])]
      .flatMap((value): string[] => {
        try {
          const url = new URL(value);
          return url.protocol === "https:" ? [url.origin] : [];
        } catch {
          return [];
        }
      });
    // Official catalogs are fetched eight at a time, but D1 snapshot writes
    // are intentionally narrower. Eight simultaneous multi-chunk ingests
    // saturated the Worker/D1 path and made otherwise valid late sources time
    // out; two lanes retain throughput without write contention.
    const fetchedAt = Date.now();
    let ingestWaitMs = 0, ingestMs = 0;
    // Lease one HTTP chunk, not an entire company's snapshot. Large catalogs
    // used to monopolize both writers for 50-100 seconds while every other
    // source waited. FIFO chunk leases preserve the two-writer D1 limit.
    const fairFetch: typeof fetch = async (input, init) => {
      const queuedAt = Date.now();
      return withIngestSlot(async () => {
        const acquiredAt = Date.now();
        ingestWaitMs += acquiredAt - queuedAt;
        try {
          const response = await fetch(input, init);
          const body = await response.arrayBuffer();
          return new Response(body, { status: response.status, headers: response.headers });
        } finally { ingestMs += Date.now() - acquiredAt; }
      });
    };
    const ingested = await ingestJobSnapshotInChunks({
      allowedOrigins: [...new Set(allowedOrigins)].slice(0, 5),
      authorization: githubOidcToken,
      completeListing: result.completeListing,
      endpoint: ingestUrl,
      jobs: result.jobs,
      listingUrl,
      sourceId: source.id,
      timeoutMs: 120_000,
      fetcher: fairFetch,
      retentionNow: new Date().toISOString(),
    });
    const verifyStartedAt = Date.now();
    const verifiedDbSamples = forcedSourceIds.has(source.id)
      ? await verifySourceSnapshot(siteUrl, source.id, result.jobs)
      : 0;
    const verifyMs = Date.now() - verifyStartedAt;
    const payload = { ...ingested, verifiedDbSamples };
    return {
      sourceId: source.id,
      status: "succeeded",
      jobs: payload.jobs,
      created: payload.created,
      updated: payload.updated,
      verifiedDbSamples: payload.verifiedDbSamples,
      elapsedMs: Date.now() - startedAt,
      fetchMs: fetchedAt - startedAt,
      ingestWaitMs,
      ingestMs,
      verifyMs,
      error: null,
    };
  } catch (error) {
    return {
      sourceId: source.id,
      status: "failed",
      jobs: 0,
      created: 0,
      updated: 0,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown request-fallback error.",
    };
  }
};

async function main(): Promise<void> {
  const sources = await liveSources();
  const summaries: RecoverySummary[] = new Array(sources.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, async () => {
    while (cursor < sources.length) {
      const index = cursor++;
      summaries[index] = await recover(sources[index]);
      // Emit each company as soon as it finishes. A later source failure no
      // longer hides which official catalogs were already verified, and the
      // elapsed time makes a newly slow board immediately actionable.
      process.stdout.write(`${JSON.stringify(summaries[index])}\n`);
    }
  }));
  const summary = { attempted: summaries.length, summaries };
  if (process.env.REQUEST_FALLBACK_RESULT_PATH) {
    await mkdir(dirname(process.env.REQUEST_FALLBACK_RESULT_PATH), { recursive: true });
    await writeFile(process.env.REQUEST_FALLBACK_RESULT_PATH, JSON.stringify(summary));
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (summaries.some((summary) => summary.status === "failed")) process.exitCode = 1;
}

await main();
