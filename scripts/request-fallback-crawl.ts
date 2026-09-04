import { crawlSource, type CrawlSource } from "../lib/crawler.ts";
import { ingestJobSnapshotInChunks } from "../lib/job-snapshot-transport.ts";
import { isRequestFallbackDue, recoverCheckpointedCatalog } from "../lib/request-fallback-recovery.ts";
import { isSafeCareerListingUrl } from "../lib/url-remediation.ts";

type LiveSource = {
  id: string;
  company: string;
  postingUrl: string | null;
  adapter: CrawlSource["adapter"];
  nextRunAt: string | null;
};

type RecoverySummary = {
  sourceId: string;
  status: "succeeded" | "failed";
  jobs: number;
  created: number;
  updated: number;
  error: string | null;
};

const siteUrl = (process.env.REQUEST_FALLBACK_LIVE_URL
  ?? "https://job-pulse-realtime.autodev61.chatgpt.site").replace(/\/$/, "");
const ingestUrl = process.env.REQUEST_FALLBACK_INGEST_URL?.trim() || `${siteUrl}/api/pulse`;
const sourceIds = [...new Set((process.env.REQUEST_FALLBACK_SOURCE_IDS ?? "legacy-row-826,p2-0075-american-family-insurance")
  .split(",").map((value) => value.trim()).filter(Boolean))].slice(0, 48);
const forcedSourceIds = new Set((process.env.REQUEST_FALLBACK_FORCE_SOURCE_IDS ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean));
const concurrency = Math.max(1, Math.min(8,
  Number.parseInt(process.env.REQUEST_FALLBACK_CONCURRENCY ?? "4", 10) || 4));
let cachedOidc = { value: "", expiresAt: 0 };

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
  const response = await fetch(`${siteUrl}/api/pulse?resource=sources&ids=${encodeURIComponent(sourceIds.join(","))}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Live source inventory returned HTTP ${response.status}.`);
  const inventory = await response.json() as LiveSource[];
  const byId = new Map(inventory.map((source) => [source.id, source]));
  const now = new Date();
  return sourceIds.flatMap((sourceId): CrawlSource[] => {
    const source = byId.get(sourceId);
    if (!source?.postingUrl) throw new Error(`Request-fallback source ${sourceId} is unavailable.`);
    if (!isRequestFallbackDue(source.nextRunAt, now, forcedSourceIds.has(source.id))) return [];
    return [{
      id: source.id,
      company: source.company,
      postingUrl: source.postingUrl,
      adapter: source.adapter,
    }];
  });
};

const recover = async (source: CrawlSource): Promise<RecoverySummary> => {
  try {
    // The independent Node.js runner has a much larger execution envelope
    // than one Sites Worker request. Drain every paged official catalog here;
    // non-paged sources return immediately from the same helper. This avoids
    // repeatedly ingesting page one for a newly promoted priority source.
    const result = await recoverCheckpointedCatalog(source, fetch, crawlSource, { maxPasses: 40 });
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
    const payload = await ingestJobSnapshotInChunks({
      allowedOrigins: [...new Set(allowedOrigins)].slice(0, 5),
      authorization: githubOidcToken,
      completeListing: result.completeListing,
      endpoint: ingestUrl,
      jobs: result.jobs,
      listingUrl,
      sourceId: source.id,
      timeoutMs: 120_000,
    });
    return {
      sourceId: source.id,
      status: "succeeded",
      jobs: payload.jobs,
      created: payload.created,
      updated: payload.updated,
      error: null,
    };
  } catch (error) {
    return {
      sourceId: source.id,
      status: "failed",
      jobs: 0,
      created: 0,
      updated: 0,
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
    }
  }));
  process.stdout.write(`${JSON.stringify({ attempted: summaries.length, summaries })}\n`);
  if (summaries.some((summary) => summary.status === "failed")) process.exitCode = 1;
}

await main();
