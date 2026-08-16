import { crawlSource, type CrawlSource } from "../lib/crawler.ts";
import { recoverCheckpointedCatalog } from "../lib/request-fallback-recovery.ts";
import { isSafeCareerListingUrl } from "../lib/url-remediation.ts";

type LiveSource = {
  id: string;
  company: string;
  postingUrl: string | null;
  adapter: CrawlSource["adapter"];
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
const sourceIds = [...new Set((process.env.REQUEST_FALLBACK_SOURCE_IDS ?? "p5-0722-saic,p5-1039-revolut,audit-row-342,legacy-row-826")
  .split(",").map((value) => value.trim()).filter(Boolean))].slice(0, 10);
const concurrency = 2;
const checkpointedSourceIds = new Set([
  "p4-0241-cgi",
  "p5-1018-penn-medicine",
]);
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
  const response = await fetch(`${siteUrl}/api/pulse?resource=sources&limit=2000`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Live source inventory returned HTTP ${response.status}.`);
  const inventory = await response.json() as LiveSource[];
  const byId = new Map(inventory.map((source) => [source.id, source]));
  return sourceIds.map((sourceId) => {
    const source = byId.get(sourceId);
    if (!source?.postingUrl) throw new Error(`Request-fallback source ${sourceId} is unavailable.`);
    return {
      id: source.id,
      company: source.company,
      postingUrl: source.postingUrl,
      adapter: source.adapter,
    };
  });
};

const recover = async (source: CrawlSource): Promise<RecoverySummary> => {
  try {
    const result = checkpointedSourceIds.has(source.id)
      ? await recoverCheckpointedCatalog(source, fetch, crawlSource)
      : await crawlSource(source, fetch, new Date());
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
    const bearer = await githubOidcToken();
    const response = await fetch(ingestUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "ingestBrowserJobs",
        sourceId: source.id,
        listingUrl,
        jobs: result.jobs,
        allowedOrigins: [...new Set(allowedOrigins)].slice(0, 5),
        completeListing: result.completeListing,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const payload = await response.json().catch(() => null) as {
      jobs?: number; created?: number; updated?: number; error?: string;
    } | null;
    if (!response.ok) throw new Error(`Production ingest returned HTTP ${response.status}${payload?.error ? `: ${payload.error}` : "."}`);
    return {
      sourceId: source.id,
      status: "succeeded",
      jobs: payload?.jobs ?? result.jobs.length,
      created: payload?.created ?? 0,
      updated: payload?.updated ?? 0,
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
