const siteUrl = (process.env.JOB_PULSE_SITE_URL || "https://job-pulse-realtime.autodev61.chatgpt.site").replace(/\/$/, "");
const boundedInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed))) : fallback;
};
const maximumMinutes = boundedInteger(process.env.JOB_PULSE_MAX_RUN_MINUTES, 20, 1, 20);
// Each API call still leases and crawls exactly one company. Parallelizing
// independent requests here raises throughput without letting one slow or
// malformed source consume a multi-company Worker request.
const requestConcurrency = boundedInteger(process.env.JOB_PULSE_REQUEST_CONCURRENCY, 4, 1, 8);
const apiUrl = `${siteUrl}/api/pulse`;
const audience = "job-pulse-realtime";
const startedAt = Date.now();
const deadline = startedAt + maximumMinutes * 60_000;

const oidcRequestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const oidcRequestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
if (!oidcRequestUrl || !oidcRequestToken) throw new Error("GitHub Actions OIDC is unavailable.");

let cachedOidc = { value: "", expiresAt: 0 };
let pendingOidc = null;

const jwtExpiryMs = (token) => {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return Number(payload.exp) * 1_000;
  } catch {
    return 0;
  }
};

const oidcToken = async () => {
  // GitHub OIDC JWTs are intentionally short-lived. A crawl can run for
  // longer than one token lifetime, so refresh before each request window.
  if (cachedOidc.value && cachedOidc.expiresAt > Date.now() + 90_000) return cachedOidc.value;
  if (pendingOidc) return pendingOidc;
  pendingOidc = (async () => {
    const tokenUrl = new URL(oidcRequestUrl);
    tokenUrl.searchParams.set("audience", audience);
    const tokenResponse = await fetch(tokenUrl, {
      headers: { authorization: `Bearer ${oidcRequestToken}` },
    });
    if (!tokenResponse.ok) throw new Error(`GitHub Actions OIDC returned HTTP ${tokenResponse.status}.`);
    const tokenPayload = await tokenResponse.json();
    if (typeof tokenPayload.value !== "string" || !tokenPayload.value) throw new Error("GitHub Actions OIDC token was missing.");
    const expiresAt = jwtExpiryMs(tokenPayload.value);
    if (!expiresAt) throw new Error("GitHub Actions OIDC token expiry was missing.");
    cachedOidc = { value: tokenPayload.value, expiresAt };
    return cachedOidc.value;
  })();
  try {
    return await pendingOidc;
  } finally {
    pendingOidc = null;
  }
};

const summary = {
  rounds: 0,
  requests: 0,
  attempted: 0,
  succeeded: 0,
  failed: 0,
  blocked: 0,
  created: 0,
  updated: 0,
  closed: 0,
  requestErrors: 0,
  drained: false,
  stopReason: null,
  staleRunsFinalized: 0,
  requestConcurrency,
};

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

const retry = async (operation, attempts = 3, delayMs = 1_000) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
};

const postAction = async (action, timeoutMs) => {
  const token = await oidcToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`${action} exceeded ${Math.round(timeoutMs / 1_000)} seconds.`)), timeoutMs);
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action, ...(action === "scheduledCrawlBatch" ? { limit: 1 } : {}) }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${action} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
    const result = JSON.parse(text);
    return result;
  } finally {
    clearTimeout(timeout);
  }
};

// The prior 42-second client abort canceled otherwise healthy Sites Workers
// at 41-42 seconds. Source fetches are already internally bounded, so leave
// enough time for the final D1 sync while staying below the edge request cap.
const crawlOne = () => postAction("scheduledCrawlBatch", 55_000);

const isRecoverableRequestError = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  return /aborted|abort|exceeded|timed out|fetch failed|network|socket|ECONN|HTTP 5\d\d/i.test(message);
};

let consecutiveRequestErrorRounds = 0;
while (Date.now() < deadline) {
  summary.rounds += 1;
  const settled = await Promise.allSettled(Array.from({ length: requestConcurrency }, () => crawlOne()));
  summary.requests += settled.length;
  const fulfilled = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const rejected = settled.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  summary.requestErrors += rejected.length;
  for (const error of rejected) console.error(error instanceof Error ? error.message : String(error));
  for (const result of fulfilled) {
    for (const key of ["attempted", "succeeded", "failed", "blocked", "created", "updated", "closed"]) {
      summary[key] += number(result[key]);
    }
  }
  if (fulfilled.length === requestConcurrency && fulfilled.every((result) => number(result.attempted) === 0)) {
    summary.drained = true;
    break;
  }
  if (rejected.some((error) => !isRecoverableRequestError(error))) {
    throw new Error("Production crawl API authorization or configuration failed.");
  }
  // A single transient edge failure must not stop the other healthy workers.
  // Count only rounds where every independent request failed.
  consecutiveRequestErrorRounds = rejected.length === requestConcurrency ? consecutiveRequestErrorRounds + 1 : 0;
  if (consecutiveRequestErrorRounds >= 3) {
    // Browser recovery is the independent safety net for slow/edge-blocked
    // sources. Stop this bounded native drain cleanly so the recovery job can
    // run instead of marking the whole scheduled workflow as a hard failure.
    summary.stopReason = "consecutive-request-errors";
    break;
  }
}

// Edge capacity can remain briefly saturated after the final parallel round.
// Retry only the compact finalization and verification calls; never repeat a
// completed source crawl just because post-drain observability was delayed.
const staleRunRepair = await retry(() => postAction("finalizeStaleCrawlRuns", 15_000));
summary.staleRunsFinalized = number(staleRunRepair.finalized);

const getJson = async (resource, timeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`${resource} verification exceeded ${Math.round(timeoutMs / 1_000)} seconds.`)),
    timeoutMs,
  );
  try {
    const response = await fetch(`${apiUrl}?resource=${encodeURIComponent(resource)}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${resource} verification returned HTTP ${response.status}.`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
};

// Source health is computed with grouped/windowed aggregates so the complete
// 1,400+ source inventory remains practical to inspect after every drain.
// Treat telemetry timeouts as degraded observability rather than retrying the
// crawl itself; the compact run-status query is the required postcondition.
const runStatus = await retry(() => getJson("runStatus", 15_000));
const [overviewResult, sourcesResult] = await Promise.allSettled([
  getJson("overview", 15_000),
  getJson("sources", 15_000),
]);
const overview = overviewResult.status === "fulfilled" ? overviewResult.value : null;
const sources = sourcesResult.status === "fulfilled" ? sourcesResult.value : [];
const overviewAvailable = overviewResult.status === "fulfilled";
const sourceHealthAvailable = sourcesResult.status === "fulfilled";
if (!overviewAvailable) {
  console.warn(`Overview unavailable: ${overviewResult.reason instanceof Error ? overviewResult.reason.message : String(overviewResult.reason)}`);
}
if (!sourceHealthAvailable) {
  console.warn(`Detailed source health unavailable: ${sourcesResult.reason instanceof Error ? sourcesResult.reason.message : String(sourcesResult.reason)}`);
}
const sourceCounts = {};
for (const source of sources) sourceCounts[source.health] = (sourceCounts[source.health] || 0) + 1;
const healthyZeroSources = sources
  .filter((source) => (source.health === "empty" || source.health === "healthy") && number(source.currentJobs) === 0)
  .map((source) => source.id);
const suspiciousClosures = (Array.isArray(runStatus.recent) ? runStatus.recent : [])
  .filter((run) => number(run.jobsClosed) >= 25
    && number(run.jobsSeen) <= Math.max(5, Math.floor(number(run.jobsClosed) * 0.1)))
  .map((run) => ({ sourceId: run.sourceId, jobsSeen: number(run.jobsSeen), jobsClosed: number(run.jobsClosed) }));
const result = {
  ...summary,
  elapsedMinutes: Math.round((Date.now() - startedAt) / 600) / 100,
  overview: {
    openJobs: overview?.newMatches ?? null,
    activeSources: overview?.activeSources ?? null,
    sourceErrors: overview?.sourceErrors ?? null,
    unsentAlerts: overview?.unsentAlerts ?? null,
  },
  runStatus: {
    running: number(runStatus.running),
    staleRunning: number(runStatus.staleRunning),
  },
  totalSources: sources.length,
  sourceCounts,
  healthyZeroSources,
  suspiciousClosures,
  overviewAvailable,
  sourceHealthAvailable,
};
console.log(JSON.stringify(result));

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFile } = await import("node:fs/promises");
  await appendFile(process.env.GITHUB_STEP_SUMMARY, [
    "## Job Pulse crawl",
    "",
    `- Due queue drained: ${result.drained ? "yes" : "no (time limit reached)"}`,
    `- Sources attempted: ${result.attempted}`,
    `- Successful / failed / blocked: ${result.succeeded} / ${result.failed} / ${result.blocked}`,
    `- Jobs created / updated / closed: ${result.created} / ${result.updated} / ${result.closed}`,
    `- Runtime: ${result.elapsedMinutes} minutes`,
    `- Independent request concurrency: ${result.requestConcurrency}`,
    `- Stop reason: ${result.stopReason || "queue drained or time limit reached"}`,
    `- Stale crawl rows finalized: ${result.staleRunsFinalized}`,
    `- Current source health: ${result.sourceHealthAvailable ? JSON.stringify(result.sourceCounts) : "detailed view timed out; overview remained healthy"}`,
    `- Successful empty sources (${result.healthyZeroSources.length}): ${result.healthyZeroSources.join(", ") || "none"}`,
    `- Suspicious recent closure runs: ${result.suspiciousClosures.length ? JSON.stringify(result.suspiciousClosures) : "none"}`,
    "",
  ].join("\n"));
}
