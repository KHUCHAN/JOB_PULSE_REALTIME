import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Frame, type Page } from "playwright";
import catalogSeed from "../db/seed/sources.json" with { type: "json" };
import { classifyJobAreas, jobAreaClassificationMarker } from "../lib/job-area-classifier.ts";
import { classifyJobRegion } from "../lib/job-region-classifier.ts";
import { jobsFromBrowserAnchors, type BrowserAnchor } from "../lib/browser-job-extractor.ts";
import { browserRecoveryDue, needsBrowserFallback, type LatestCrawlSummary } from "../lib/browser-fallback-selection.ts";
import { numericPaginationTargets } from "../lib/browser-pagination.ts";
import { anchorsFromHtml, deltaInternshipListingUrl, extractJobsFromHtml, jobsFromTeslaState, type CrawledFacet, type CrawledJob, type CrawlSource, type TeslaState } from "../lib/crawler.ts";
import { careerCandidates, isSafeCareerListingUrl } from "../lib/url-remediation.ts";

export type BrowserFallbackResult = {
  source: CrawlSource;
  status: number | null;
  finalUrl: string | null;
  jobs: CrawledJob[];
  facets?: CrawledFacet[];
  browserState?: { kind: "tesla"; state: TeslaState };
  error: string | null;
};

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = resolve(projectRoot, "node_modules/.bin/wrangler");
const outputPath = resolve(projectRoot, "output/playwright/browser-fallback/results.json");
const sqlPath = resolve(projectRoot, ".codex_tmp/browser-fallback.sql");
const concurrency = Math.max(1, Number.parseInt(process.env.BROWSER_FALLBACK_CONCURRENCY ?? "12", 10));
const limit = Number.parseInt(process.env.BROWSER_FALLBACK_LIMIT ?? "500", 10);
const headless = process.env.BROWSER_FALLBACK_HEADFUL !== "1";
const forceAll = process.env.BROWSER_FALLBACK_ALL === "1";
const targetSourceId = process.env.BROWSER_FALLBACK_SOURCE_ID?.trim() || null;
const targetSourceIds = new Set((process.env.BROWSER_FALLBACK_SOURCE_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const prioritySourceIds = new Set((process.env.BROWSER_FALLBACK_PRIORITY_SOURCE_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const productionIngestUrl = process.env.BROWSER_FALLBACK_INGEST_URL?.trim() || null;
const productionIngestSecret = process.env.BROWSER_FALLBACK_INGEST_SECRET?.trim() || null;
const liveUrl = process.env.BROWSER_FALLBACK_LIVE_URL?.trim().replace(/\/$/, "") || null;
const dryRun = process.env.BROWSER_FALLBACK_DRY_RUN === "1";

let cachedOidc = { value: "", expiresAt: 0 };

export const browserListingSource = (source: CrawlSource): CrawlSource => {
  if (source.id !== "audit-row-342") return source;
  // Delta's persisted catalog URL can carry a native pagination cursor from
  // the request crawler. A browser recovery must instead start at the first
  // page of Delta's exact university-program category or it can repeatedly
  // ingest an arbitrary page from the unfiltered company catalog.
  return { ...source, postingUrl: deltaInternshipListingUrl(source.postingUrl) };
};

const githubOidcToken = async (): Promise<string | null> => {
  if (productionIngestSecret) return productionIngestSecret;
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) return null;
  if (cachedOidc.value && cachedOidc.expiresAt > Date.now() + 60_000) return cachedOidc.value;
  const endpoint = new URL(requestUrl);
  endpoint.searchParams.set("audience", "job-pulse-realtime");
  const response = await fetch(endpoint, { headers: { authorization: `Bearer ${requestToken}` } });
  if (!response.ok) throw new Error(`GitHub Actions OIDC returned HTTP ${response.status}.`);
  const payload = await response.json() as { value?: unknown };
  if (typeof payload.value !== "string" || !payload.value) throw new Error("GitHub Actions OIDC token was missing.");
  const encoded = payload.value.split(".")[1];
  const claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { exp?: unknown };
  if (typeof claims.exp !== "number") throw new Error("GitHub Actions OIDC token expiry was missing.");
  cachedOidc = { value: payload.value, expiresAt: claims.exp * 1_000 };
  return payload.value;
};

const d1 = async (args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync(wrangler, [
    "d1", "execute", "site-creator-d1", "--config", "wrangler.local.jsonc", "--local",
    "--persist-to", ".wrangler/state", "--json", ...args,
  ], { cwd: projectRoot, maxBuffer: 100 * 1024 * 1024 });
  return stdout;
};

const problemSources = async (): Promise<CrawlSource[]> => {
  if (targetSourceIds.size > 0 && liveUrl) {
    // Targeted recovery must use the live D1 URL, not the checked-in catalog
    // snapshot. Source repairs can update posting_url (Delta's keyword route
    // is one example), and replaying the stale seed would recover the wrong
    // page and re-ingest navigation links.
    const response = await fetch(`${liveUrl}/api/pulse?resource=sources`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Live source inventory returned HTTP ${response.status}.`);
    const sources = await response.json() as Array<{
      id: string; company: string; postingUrl: string | null; adapter: CrawlSource["adapter"];
    }>;
    return sources.flatMap((source): CrawlSource[] => targetSourceIds.has(source.id) && source.postingUrl
      ? [browserListingSource({ id: source.id, company: source.company, postingUrl: source.postingUrl, adapter: source.adapter })]
      : []);
  }
  if (targetSourceIds.size > 0) return catalogSeed.sources.flatMap((source): CrawlSource[] => targetSourceIds.has(source.id) && source.postingUrl
    ? [browserListingSource({ id: source.id, company: source.company, postingUrl: source.postingUrl, adapter: source.adapter as CrawlSource["adapter"] })]
    : []);
  if (liveUrl) {
    const response = await fetch(`${liveUrl}/api/pulse?resource=sources`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Live source inventory returned HTTP ${response.status}.`);
    const sources = await response.json() as Array<{
      id: string; company: string; postingUrl: string | null; talentUrl: string | null;
      adapter: CrawlSource["adapter"];
      health: string; currentJobs: number; lastCheckedAt: string | null; nextRunAt: string | null;
    }>;
    const candidateUrl = (source: { postingUrl: string | null; talentUrl: string | null }): string | null => {
      if (source.postingUrl) return source.postingUrl;
      const talentUrl = source.talentUrl;
      if (!talentUrl || /(?:talent|alert|introduceyourself|sign[_-]?in|\/login|\/apply)(?:[/?#]|$)/i.test(talentUrl)) return null;
      if (!/(?:jobs?|careers?|opportunities|openings?|positions?|search)/i.test(talentUrl)) return null;
      return talentUrl;
    };
    const healthRank = (source: { health: string; currentJobs: number }): number => {
      // Empty feeds are the highest-risk state: they may represent a
      // rendered ATS board that native HTTP parsing missed.  Give those a
      // browser pass before retrying sources that already have a usable
      // inventory, while still rotating through every failing category.
      const emptyRank = source.currentJobs === 0 ? 0 : 1;
      const stateRank = source.health === "healthy" ? 0
        : source.health === "inactive" ? 1
          : source.health === "blocked" ? 2 : 3;
      return emptyRank * 10 + stateRank;
    };
    return sources
      .map((source) => ({ ...source, candidateUrl: candidateUrl(source) }))
      .filter((source) => source.candidateUrl && browserRecoveryDue(source))
      .sort((left, right) => Number(prioritySourceIds.has(right.id)) - Number(prioritySourceIds.has(left.id))
        || healthRank(left) - healthRank(right)
        || Date.parse(left.lastCheckedAt ?? "1970-01-01") - Date.parse(right.lastCheckedAt ?? "1970-01-01")
        || left.company.localeCompare(right.company))
      .slice(0, Number.isFinite(limit) ? Math.max(1, limit) : 500)
      .map((source) => browserListingSource({ id: source.id, company: source.company, postingUrl: source.candidateUrl!, adapter: source.adapter }));
  }
  const sql = `WITH latest AS (
    SELECT source_id, status, jobs_seen, ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY started_at DESC) row_number
    FROM crawl_runs
  ) SELECT s.id, s.company, s.posting_url, s.adapter, l.status, l.jobs_seen
    FROM sources s LEFT JOIN latest l ON s.id = l.source_id AND l.row_number = 1
    WHERE s.enabled = 1 AND s.posting_url IS NOT NULL
    ORDER BY s.company`;
  const parsed = JSON.parse(await d1(["--command", sql])) as Array<{ results: Array<{
    id: string;
    company: string;
    posting_url: string;
    adapter: CrawlSource["adapter"];
    status: LatestCrawlSummary["status"];
    jobs_seen: number | null;
  }> }>;
  return parsed.flatMap((value) => value.results)
    .filter((row) => !targetSourceId || row.id === targetSourceId)
    .filter((row) => needsBrowserFallback({ status: row.status, jobsSeen: row.jobs_seen }, forceAll))
    .slice(0, Number.isFinite(limit) ? Math.max(1, limit) : 500)
    .map((row) => browserListingSource({
    id: row.id,
    company: row.company,
    postingUrl: row.posting_url,
    adapter: row.adapter,
    }));
};

const anchorsOnPage = async (page: Page): Promise<BrowserAnchor[]> => {
  // Hosted ATS boards such as iCIMS put the actual job table in an
  // `in_iframe=1` child document. Read every frame instead of only the
  // branding shell in the top document.
  const anchors: BrowserAnchor[] = [];
  for (const frame of page.frames()) {
    try {
      anchors.push(...await frame.locator("a[href]").evaluateAll((nodes) => nodes.map((anchor) => ({
        href: (anchor as HTMLAnchorElement).href,
        text: (anchor.textContent ?? "").replace(/\s+/g, " ").trim(),
      }))));
    } catch {
      // A frame can disappear while an ATS page navigates; keep other frames.
    }
  }
  return [...new Map(anchors.map((anchor) => [`${anchor.href}\u0000${anchor.text}`, anchor])).values()];
};

const jobsOnPage = async (page: Page, source: CrawlSource): Promise<CrawledJob[]> => {
  const structured: CrawledJob[] = [];
  for (const frame of page.frames()) {
    try {
      structured.push(...extractJobsFromHtml(await frame.content(), source).jobs);
    } catch {
      // Ignore a frame that navigated away while its HTML was read.
    }
  }
  const linked = jobsFromBrowserAnchors(await anchorsOnPage(page), source);
  const unique = new Map([...structured, ...linked].map((job) => [job.officialUrl, job]));
  return [...unique.values()];
};

type PaginationControl = { frame: Frame; index: number; label: string };

const paginationControls = async (page: Page): Promise<PaginationControl[]> => {
  const controls: PaginationControl[] = [];
  for (const frame of page.frames()) {
    try {
      const values = await frame.locator("a, button").evaluateAll((nodes) => nodes.map((control, index) => ({
        index,
        label: (control.getAttribute("aria-label") || control.textContent || "").replace(/\s+/g, " ").trim(),
      })));
      controls.push(...values.map((value) => ({ ...value, frame })));
    } catch {
      // Ignore a frame replaced during navigation.
    }
  }
  return controls;
};

const jobsAcrossPages = async (page: Page, source: CrawlSource): Promise<CrawledJob[]> => {
  const unique = new Map<string, CrawledJob>();
  const collect = async (): Promise<void> => {
    for (const job of await jobsOnPage(page, source)) unique.set(job.officialUrl, job);
  };
  await collect();
  const targets = numericPaginationTargets((await paginationControls(page)).map((control) => control.label));
  for (const target of targets) {
    const controls = await paginationControls(page);
    const control = controls.find((value) => numericPaginationTargets([value.label]).includes(target));
    if (!control) continue;
    await control.frame.locator("a, button").nth(control.index).click({ timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    await collect();
  }
  return [...unique.values()];
};

const jobsViaHttp1 = async (source: CrawlSource): Promise<CrawledJob[]> => {
  try {
    const { stdout: html } = await execFileAsync("curl", [
      "--http1.1", "--location", "--silent", "--show-error", "--compressed",
      // Keep the cheap HTTP probe bounded so a slow origin cannot consume the
      // browser recovery window before client-side rendering gets a chance.
      "--connect-timeout", "5", "--max-time", "12", "--user-agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      source.postingUrl,
    ], { maxBuffer: 25 * 1024 * 1024 });
    const structured = extractJobsFromHtml(html, source).jobs;
    const linked = jobsFromBrowserAnchors(anchorsFromHtml(html), source);
    return [...new Map([...structured, ...linked].map((job) => [job.officialUrl, job])).values()];
  } catch {
    return [];
  }
};

const inspect = async (page: Page, source: CrawlSource): Promise<BrowserFallbackResult> => {
  try {
    // These sources have already failed the native pass and were selected for
    // browser recovery for precisely that reason. Re-running crawlSource here
    // can consume its full 32-second source budget before Chrome gets a chance
    // to render the board; with the 60-second per-source guard that made many
    // recoverable pages end as navigation_timeout. Try a short HTTP/1.1 pass
    // first, then give the browser the remaining budget for client rendering.
    const http1Jobs = await jobsViaHttp1(source);
    if (http1Jobs.length > 0) {
      return { source, status: 200, finalUrl: source.postingUrl, jobs: http1Jobs, error: null };
    }
    if (source.id === "p5-1077-tesla" || source.company === "Tesla") {
      const stateResponse = page.waitForResponse((response) => response.url() === "https://www.tesla.com/cua-api/apps/careers/state", { timeout: 30_000 });
      const response = await page.goto(source.postingUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const state = await (await stateResponse).json() as TeslaState;
      const jobs = jobsFromTeslaState(source, state);
      return {
        source,
        status: response?.status() ?? 200,
        finalUrl: page.url(),
        jobs,
        browserState: { kind: "tesla", state },
        error: jobs.length > 0 ? null : "Tesla browser state contained no US jobs.",
      };
    }
    const response = await page.goto(source.postingUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Client-rendered ATS pages such as Dayforce populate job cards after hydration.
    await page.waitForTimeout(3_000);
    let jobs = await jobsAcrossPages(page, source);
    if (jobs.length === 0 && response && response.status() < 400) {
      const candidates = careerCandidates(await anchorsOnPage(page), page.url());
      for (const candidate of candidates.slice(0, 2)) {
        const candidateResponse = await page.goto(candidate.href, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
        if (!candidateResponse || candidateResponse.status() >= 400) continue;
        await page.waitForTimeout(3_000);
        jobs = await jobsAcrossPages(page, source);
        if (jobs.length > 0) break;
      }
    }
    return { source, status: response?.status() ?? null, finalUrl: page.url(), jobs, error: null };
  } catch (error) {
    return { source, status: null, finalUrl: null, jobs: [], error: error instanceof Error ? error.message : "Unknown browser fallback error." };
  }
};

const inspectWithDeadline = async (page: Page, source: CrawlSource): Promise<BrowserFallbackResult> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      inspect(page, source),
      new Promise<BrowserFallbackResult>((resolveResult) => {
        timeout = setTimeout(() => {
          void page.close({ runBeforeUnload: false }).catch(() => undefined);
          resolveResult({ source, status: null, finalUrl: null, jobs: [], error: "Browser fallback exceeded 60 seconds." });
        }, 60_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

type BrowserResultCode =
  | "jobs_recovered"
  | "empty_board"
  | "http_error"
  | "blocked_challenge"
  | "navigation_timeout"
  | "navigation_error"
  | "unsafe_listing"
  | "ingest_error";

export const browserResultClassification = (result: BrowserFallbackResult): {
  status: "succeeded" | "failed" | "blocked";
  code: BrowserResultCode;
} => {
  if (result.error?.startsWith("Rejected unsafe browser listing candidate:")) return { status: "failed", code: "unsafe_listing" };
  if (result.jobs.length > 0 && result.finalUrl) return { status: "succeeded", code: "jobs_recovered" };
  if ([401, 403, 429, 520, 521, 522, 523, 524].includes(result.status ?? -1)
    || /(?:cloudflare|captcha|challenge|blocked|access denied)/i.test(result.error ?? "")) {
    return { status: "blocked", code: "blocked_challenge" };
  }
  if (result.status !== null && result.status >= 400) return { status: "failed", code: "http_error" };
  if (/exceeded 60 seconds|timeout/i.test(result.error ?? "")) return { status: "failed", code: "navigation_timeout" };
  if (result.error) return { status: "failed", code: "navigation_error" };
  // A 2xx page with no verified job identity is not an authoritative empty
  // catalog. Keep it retryable and visible as a failed recovery so a transient
  // shell/challenge cannot silently turn a source healthy with zero jobs.
  return { status: "failed", code: "empty_board" };
};

const quote = (value: string | number | null): string => {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
};

export const persistenceSql = (results: BrowserFallbackResult[]): string => {
  const now = new Date().toISOString();
  const next = new Date(Date.now() + 2 * 60 * 60 * 1_000).toISOString();
  const statements = ["PRAGMA foreign_keys = ON;", "BEGIN TRANSACTION;"];
  for (const result of results.filter((value) => value.jobs.length > 0)) {
    for (const job of result.jobs) {
      const locationRegion = classifyJobRegion(job);
      const areaMemberships = classifyJobAreas(job);
      const values = [
        randomUUID(), result.source.id, job.externalId, job.title, job.company, job.location, job.arrangement,
        job.employmentType, job.summary, job.description ?? null, job.responsibilities ?? null, job.qualifications ?? null,
        JSON.stringify(job.skills ?? []), job.department ?? null, job.team ?? null, job.businessUnit ?? null,
        job.jobFamily ?? null, job.jobFunction ?? null, job.industry ?? null, job.office ?? null,
        JSON.stringify(job.secondaryLocations ?? []), job.locationCity ?? null, job.locationState ?? null,
        job.locationCountry ?? null, locationRegion, job.locationPostalCode ?? null, job.latitude ?? null, job.longitude ?? null,
        job.salaryMin ?? null, job.salaryMax ?? null, job.salaryCurrency ?? null, job.salaryInterval ?? null,
        job.benefits ?? null, job.educationRequirements ?? null, job.experienceRequirements ?? null,
        job.experienceLevel ?? null, job.shiftSchedule ?? null, job.travelRequirements ?? null,
        job.securityClearance ?? null, JSON.stringify(job.languages ?? []), job.requisitionId ?? null,
        job.applyUrl ?? null, job.sourcePostedText ?? null, job.sourceUpdatedAt ?? null, job.validThrough ?? null,
        job.rawPayload ? JSON.stringify(job.rawPayload) : null, job.officialUrl, jobAreaClassificationMarker(now),
      ];
      statements.push(`INSERT INTO jobs (id, source_id, external_id, title, company, location, arrangement, employment_type, summary, description, responsibilities, qualifications, skills, department, team, business_unit, job_family, job_function, industry, office, secondary_locations, location_city, location_state, location_country, location_region, location_postal_code, latitude, longitude, salary_min, salary_max, salary_currency, salary_interval, benefits, education_requirements, experience_requirements, experience_level, shift_schedule, travel_requirements, security_clearance, languages, requisition_id, apply_url, source_posted_text, source_updated_at, valid_through, raw_payload, official_url, area_classified_at, status, published_at, first_seen_at, last_seen_at) VALUES (${values.map(quote).join(", ")}, 'open', ${quote(job.publishedAt)}, ${quote(now)}, ${quote(now)}) ON CONFLICT(source_id, official_url) DO UPDATE SET external_id=COALESCE(excluded.external_id,jobs.external_id),title=excluded.title,company=excluded.company,location=COALESCE(excluded.location,jobs.location),arrangement=CASE WHEN excluded.arrangement='unknown' THEN jobs.arrangement ELSE excluded.arrangement END,employment_type=COALESCE(excluded.employment_type,jobs.employment_type),summary=COALESCE(excluded.summary,jobs.summary),description=COALESCE(excluded.description,jobs.description),responsibilities=COALESCE(excluded.responsibilities,jobs.responsibilities),qualifications=COALESCE(excluded.qualifications,jobs.qualifications),skills=CASE WHEN excluded.skills <> '[]' THEN excluded.skills ELSE jobs.skills END,department=COALESCE(excluded.department,jobs.department),team=COALESCE(excluded.team,jobs.team),business_unit=COALESCE(excluded.business_unit,jobs.business_unit),job_family=COALESCE(excluded.job_family,jobs.job_family),job_function=COALESCE(excluded.job_function,jobs.job_function),industry=COALESCE(excluded.industry,jobs.industry),office=COALESCE(excluded.office,jobs.office),secondary_locations=CASE WHEN excluded.secondary_locations <> '[]' THEN excluded.secondary_locations ELSE jobs.secondary_locations END,location_city=COALESCE(excluded.location_city,jobs.location_city),location_state=COALESCE(excluded.location_state,jobs.location_state),location_country=COALESCE(excluded.location_country,jobs.location_country),location_region=CASE WHEN excluded.location_region='unknown' AND jobs.location_region IS NOT NULL THEN jobs.location_region ELSE excluded.location_region END,location_postal_code=COALESCE(excluded.location_postal_code,jobs.location_postal_code),latitude=COALESCE(excluded.latitude,jobs.latitude),longitude=COALESCE(excluded.longitude,jobs.longitude),salary_min=COALESCE(excluded.salary_min,jobs.salary_min),salary_max=COALESCE(excluded.salary_max,jobs.salary_max),salary_currency=COALESCE(excluded.salary_currency,jobs.salary_currency),salary_interval=COALESCE(excluded.salary_interval,jobs.salary_interval),benefits=COALESCE(excluded.benefits,jobs.benefits),education_requirements=COALESCE(excluded.education_requirements,jobs.education_requirements),experience_requirements=COALESCE(excluded.experience_requirements,jobs.experience_requirements),experience_level=COALESCE(excluded.experience_level,jobs.experience_level),shift_schedule=COALESCE(excluded.shift_schedule,jobs.shift_schedule),travel_requirements=COALESCE(excluded.travel_requirements,jobs.travel_requirements),security_clearance=COALESCE(excluded.security_clearance,jobs.security_clearance),languages=CASE WHEN excluded.languages <> '[]' THEN excluded.languages ELSE jobs.languages END,requisition_id=COALESCE(excluded.requisition_id,jobs.requisition_id),apply_url=COALESCE(excluded.apply_url,jobs.apply_url),source_posted_text=COALESCE(excluded.source_posted_text,jobs.source_posted_text),source_updated_at=COALESCE(excluded.source_updated_at,jobs.source_updated_at),valid_through=COALESCE(excluded.valid_through,jobs.valid_through),raw_payload=COALESCE(excluded.raw_payload,jobs.raw_payload),area_classified_at=excluded.area_classified_at,status='open',published_at=COALESCE(excluded.published_at,jobs.published_at),last_seen_at=excluded.last_seen_at,closed_at=NULL,updated_at=CURRENT_TIMESTAMP;`);
      statements.push(`DELETE FROM job_topics WHERE topic_key LIKE 'area:%' AND job_id IN (SELECT id FROM jobs WHERE source_id=${quote(result.source.id)} AND official_url=${quote(job.officialUrl)});`);
      for (const area of areaMemberships) {
        statements.push(`INSERT INTO job_topics (job_id, topic_key, score, evidence, classified_at) SELECT id, ${quote(`area:${area.areaKey}`)}, ${area.score}, ${quote(JSON.stringify(area.evidence))}, ${quote(now)} FROM jobs WHERE source_id=${quote(result.source.id)} AND official_url=${quote(job.officialUrl)} ON CONFLICT(job_id, topic_key) DO UPDATE SET score=excluded.score,evidence=excluded.evidence,classified_at=excluded.classified_at;`);
      }
    }
    for (const facet of result.facets ?? []) {
      for (const value of facet.values) {
        statements.push(`INSERT INTO source_facets (id, source_id, facet_key, facet_label, value_key, value_label, job_count, observed_at) VALUES (${[randomUUID(), result.source.id, facet.key, facet.label, value.key, value.label, value.count, now].map(quote).join(", ")}) ON CONFLICT(source_id, facet_key, value_key) DO UPDATE SET facet_label=excluded.facet_label,value_label=excluded.value_label,job_count=excluded.job_count,observed_at=excluded.observed_at,updated_at=CURRENT_TIMESTAMP;`);
      }
    }
    statements.push(`INSERT INTO crawl_runs (id, source_id, scheduled_for, started_at, finished_at, status, response_status, jobs_seen, jobs_created, jobs_updated, jobs_closed, error) VALUES (${[randomUUID(), result.source.id, now, now, now, "succeeded", result.status, result.jobs.length, result.jobs.length, 0, 0, "Recovered by HTTP/1.1 or browser fallback."].map(quote).join(", ")});`);
    statements.push(`UPDATE sources SET last_crawled_at=${quote(now)},next_crawl_at=${quote(next)},updated_at=CURRENT_TIMESTAMP WHERE id=${quote(result.source.id)};`);
  }
  statements.push("COMMIT;", "");
  return statements.join("\n");
};

async function main(): Promise<void> {
  const sources = await problemSources();
  const browser = await chromium.launch({ channel: "chrome", headless }).catch(() => chromium.launch({ headless }));
  const context = await browser.newContext();
  const results: BrowserFallbackResult[] = new Array(sources.length);
  let cursor = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < sources.length) {
      const index = cursor++;
      const page = await context.newPage();
      try {
        results[index] = await inspectWithDeadline(page, sources[index]);
      } finally {
        if (!page.isClosed()) await Promise.race([
          page.close({ runBeforeUnload: false }).catch(() => undefined),
          new Promise((resolveClose) => setTimeout(resolveClose, 2_000)),
        ]);
      }
      completed += 1;
      if (completed % 25 === 0) process.stdout.write(`browser fallback ${completed}/${sources.length}\n`);
    }
  }));
  await browser.close();
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(sqlPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
  const successful = results.filter((result) => {
    if (result.jobs.length === 0 || !result.finalUrl) return false;
    const safe = isSafeCareerListingUrl(result.source.company, result.source.postingUrl, result.finalUrl);
    if (!safe) result.error = `Rejected unsafe browser listing candidate: ${result.finalUrl}`;
    return safe;
  });
  if (!dryRun && productionIngestUrl) {
    for (const result of results) {
      const bearer = await githubOidcToken();
      if (!bearer) throw new Error("Production browser ingest authorization is unavailable.");
      const classification = browserResultClassification(result);
      if (classification.status !== "succeeded" || classification.code === "empty_board") {
        const response = await fetch(productionIngestUrl, {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          body: JSON.stringify({
            action: "recordBrowserCrawlResult",
            sourceId: result.source.id,
            status: classification.status,
            responseStatus: result.status,
            jobsSeen: result.jobs.length,
            code: classification.code,
          }),
        });
        if (!response.ok) result.error = `Production browser result returned HTTP ${response.status}.`;
        continue;
      }
      const allowedOrigins = [result.finalUrl, ...result.jobs.map((job) => job.officialUrl)]
        .flatMap((value) => {
          try { return value ? [new URL(value).origin] : []; } catch { return []; }
        });
      const response = await fetch(productionIngestUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({
          action: "ingestBrowserJobs",
          sourceId: result.source.id,
          listingUrl: result.finalUrl,
          jobs: result.jobs,
          allowedOrigins: [...new Set(allowedOrigins)].slice(0, 5),
          completeListing: false,
        }),
      });
      if (!response.ok) {
        result.error = `Production browser ingest returned HTTP ${response.status}.`;
        const retry = await fetch(productionIngestUrl, {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          body: JSON.stringify({
            action: "recordBrowserCrawlResult",
            sourceId: result.source.id,
            status: "failed",
            responseStatus: response.status,
            jobsSeen: 0,
            code: "ingest_error",
          }),
        });
        if (!retry.ok) result.error += ` Result recording returned HTTP ${retry.status}.`;
      }
    }
  } else if (!dryRun && successful.length > 0) {
    await writeFile(sqlPath, persistenceSql(successful));
    await d1(["--file", sqlPath]);
  }
  process.stdout.write(`${JSON.stringify({ attempted: results.length, recovered: successful.length, jobs: successful.reduce((sum, result) => sum + result.jobs.length, 0) })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
