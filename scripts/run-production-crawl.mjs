const siteUrl = (process.env.JOB_PULSE_SITE_URL || "https://job-pulse-realtime.autodev61.chatgpt.site").replace(/\/$/, "");
const maximumMinutes = Math.max(1, Math.min(20, Number(process.env.JOB_PULSE_MAX_RUN_MINUTES || 20)));
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
};

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

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
  const settled = await Promise.allSettled([crawlOne(), crawlOne()]);
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
  if (fulfilled.length === 2 && fulfilled.every((result) => number(result.attempted) === 0)) {
    summary.drained = true;
    break;
  }
  if (rejected.some((error) => !isRecoverableRequestError(error))) {
    throw new Error("Production crawl API authorization or configuration failed.");
  }
  consecutiveRequestErrorRounds = rejected.length > 0 ? consecutiveRequestErrorRounds + 1 : 0;
  if (consecutiveRequestErrorRounds >= 3) {
    // Browser recovery is the independent safety net for slow/edge-blocked
    // sources. Stop this bounded native drain cleanly so the recovery job can
    // run instead of marking the whole scheduled workflow as a hard failure.
    summary.stopReason = "consecutive-request-errors";
    break;
  }
}

const getJson = async (resource) => {
  const controller = new AbortController();
  // The overview query can briefly exceed 30 seconds while the just-finished
  // crawl is flushing a large source into D1. Keep final health verification
  // authoritative instead of turning a successful 20-minute drain into a
  // false workflow failure. The workflow's 25-minute cap still bounds this.
  const verificationTimeoutMs = 90_000;
  const timeout = setTimeout(() => controller.abort(new Error(`${resource} verification exceeded 90 seconds.`)), verificationTimeoutMs);
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
const [overview, sources] = await Promise.all([getJson("overview"), getJson("sources")]);
const sourceCounts = {};
for (const source of sources) sourceCounts[source.health] = (sourceCounts[source.health] || 0) + 1;
const result = {
  ...summary,
  elapsedMinutes: Math.round((Date.now() - startedAt) / 600) / 100,
  overview: {
    openJobs: overview.newMatches,
    activeSources: overview.activeSources,
    sourceErrors: overview.sourceErrors,
    unsentAlerts: overview.unsentAlerts,
  },
  totalSources: sources.length,
  sourceCounts,
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
    `- Stop reason: ${result.stopReason || "queue drained or time limit reached"}`,
    `- Current source health: ${JSON.stringify(result.sourceCounts)}`,
    "",
  ].join("\n"));
}
