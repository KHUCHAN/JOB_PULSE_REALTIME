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

const crawlOne = () => postAction("scheduledCrawlBatch", 55_000);

let consecutiveDoubleErrors = 0;
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
  consecutiveDoubleErrors = rejected.length === 2 ? consecutiveDoubleErrors + 1 : 0;
  if (consecutiveDoubleErrors >= 3) throw new Error("Production crawl API failed in three consecutive rounds.");
}

const alertDispatch = await postAction("scheduledProcessAlerts", 110_000);

const getJson = async (resource) => {
  const response = await fetch(`${apiUrl}?resource=${encodeURIComponent(resource)}`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${resource} verification returned HTTP ${response.status}.`);
  return response.json();
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
  alerts: alertDispatch.alerts ?? null,
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
    `- Current source health: ${JSON.stringify(result.sourceCounts)}`,
    `- Alert dispatch: ${JSON.stringify(result.alerts)}`,
    "",
  ].join("\n"));
}
