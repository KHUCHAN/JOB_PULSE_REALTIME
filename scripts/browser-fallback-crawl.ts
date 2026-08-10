import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import { jobsFromBrowserAnchors, type BrowserAnchor } from "../lib/browser-job-extractor.ts";
import { needsBrowserFallback, type LatestCrawlSummary } from "../lib/browser-fallback-selection.ts";
import { numericPaginationTargets } from "../lib/browser-pagination.ts";
import { anchorsFromHtml, crawlSource, extractJobsFromHtml, jobsFromTeslaState, type CrawledFacet, type CrawledJob, type CrawlSource, type TeslaState } from "../lib/crawler.ts";
import { careerCandidates } from "../lib/url-remediation.ts";

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

const d1 = async (args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync(wrangler, [
    "d1", "execute", "site-creator-d1", "--config", "wrangler.local.jsonc", "--local",
    "--persist-to", ".wrangler/state", "--json", ...args,
  ], { cwd: projectRoot, maxBuffer: 100 * 1024 * 1024 });
  return stdout;
};

const problemSources = async (): Promise<CrawlSource[]> => {
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
    .map((row) => ({
    id: row.id,
    company: row.company,
    postingUrl: row.posting_url,
    adapter: row.adapter,
    }));
};

const anchorsOnPage = async (page: Page): Promise<BrowserAnchor[]> => page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => ({
  href: (anchor as HTMLAnchorElement).href,
  text: (anchor.textContent ?? "").replace(/\s+/g, " ").trim(),
})));

const jobsOnPage = async (page: Page, source: CrawlSource): Promise<CrawledJob[]> => {
  const structured = extractJobsFromHtml(await page.content(), source).jobs;
  const linked = jobsFromBrowserAnchors(await anchorsOnPage(page), source);
  const unique = new Map([...structured, ...linked].map((job) => [job.officialUrl, job]));
  return [...unique.values()];
};

const paginationControls = async (page: Page): Promise<Array<{ index: number; label: string }>> => (
  page.locator("a, button").evaluateAll((controls) => controls.map((control, index) => ({
    index,
    label: (control.getAttribute("aria-label") || control.textContent || "").replace(/\s+/g, " ").trim(),
  })))
);

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
    await page.locator("a, button").nth(control.index).click({ timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    await collect();
  }
  return [...unique.values()];
};

const jobsViaHttp1 = async (source: CrawlSource): Promise<CrawledJob[]> => {
  try {
    const { stdout: html } = await execFileAsync("curl", [
      "--http1.1", "--location", "--silent", "--show-error", "--compressed",
      "--max-time", "30", "--user-agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
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
    const direct = await crawlSource(source, fetch, new Date());
    if (direct.status === "succeeded" && direct.jobs.length > 0) {
      return { source, status: direct.responseStatus, finalUrl: source.postingUrl, jobs: direct.jobs, ...(direct.facets?.length ? { facets: direct.facets } : {}), error: null };
    }
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
        timeout = setTimeout(() => resolveResult({ source, status: null, finalUrl: null, jobs: [], error: "Browser fallback exceeded 60 seconds." }), 60_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
      const values = [
        randomUUID(), result.source.id, job.externalId, job.title, job.company, job.location, job.arrangement,
        job.employmentType, job.summary, job.description ?? null, job.responsibilities ?? null, job.qualifications ?? null,
        JSON.stringify(job.skills ?? []), job.department ?? null, job.team ?? null, job.businessUnit ?? null,
        job.jobFamily ?? null, job.jobFunction ?? null, job.industry ?? null, job.office ?? null,
        JSON.stringify(job.secondaryLocations ?? []), job.locationCity ?? null, job.locationState ?? null,
        job.locationCountry ?? null, job.locationPostalCode ?? null, job.latitude ?? null, job.longitude ?? null,
        job.salaryMin ?? null, job.salaryMax ?? null, job.salaryCurrency ?? null, job.salaryInterval ?? null,
        job.benefits ?? null, job.educationRequirements ?? null, job.experienceRequirements ?? null,
        job.experienceLevel ?? null, job.shiftSchedule ?? null, job.travelRequirements ?? null,
        job.securityClearance ?? null, JSON.stringify(job.languages ?? []), job.requisitionId ?? null,
        job.applyUrl ?? null, job.sourcePostedText ?? null, job.sourceUpdatedAt ?? null, job.validThrough ?? null,
        job.rawPayload ? JSON.stringify(job.rawPayload) : null, job.officialUrl,
      ];
      statements.push(`INSERT INTO jobs (id, source_id, external_id, title, company, location, arrangement, employment_type, summary, description, responsibilities, qualifications, skills, department, team, business_unit, job_family, job_function, industry, office, secondary_locations, location_city, location_state, location_country, location_postal_code, latitude, longitude, salary_min, salary_max, salary_currency, salary_interval, benefits, education_requirements, experience_requirements, experience_level, shift_schedule, travel_requirements, security_clearance, languages, requisition_id, apply_url, source_posted_text, source_updated_at, valid_through, raw_payload, official_url, status, published_at, first_seen_at, last_seen_at) VALUES (${values.map(quote).join(", ")}, 'open', ${quote(job.publishedAt)}, ${quote(now)}, ${quote(now)}) ON CONFLICT(source_id, official_url) DO UPDATE SET external_id=COALESCE(excluded.external_id,jobs.external_id),title=excluded.title,company=excluded.company,location=COALESCE(excluded.location,jobs.location),arrangement=CASE WHEN excluded.arrangement='unknown' THEN jobs.arrangement ELSE excluded.arrangement END,employment_type=COALESCE(excluded.employment_type,jobs.employment_type),summary=COALESCE(excluded.summary,jobs.summary),description=COALESCE(excluded.description,jobs.description),responsibilities=COALESCE(excluded.responsibilities,jobs.responsibilities),qualifications=COALESCE(excluded.qualifications,jobs.qualifications),skills=CASE WHEN excluded.skills <> '[]' THEN excluded.skills ELSE jobs.skills END,department=COALESCE(excluded.department,jobs.department),team=COALESCE(excluded.team,jobs.team),business_unit=COALESCE(excluded.business_unit,jobs.business_unit),job_family=COALESCE(excluded.job_family,jobs.job_family),job_function=COALESCE(excluded.job_function,jobs.job_function),industry=COALESCE(excluded.industry,jobs.industry),office=COALESCE(excluded.office,jobs.office),secondary_locations=CASE WHEN excluded.secondary_locations <> '[]' THEN excluded.secondary_locations ELSE jobs.secondary_locations END,location_city=COALESCE(excluded.location_city,jobs.location_city),location_state=COALESCE(excluded.location_state,jobs.location_state),location_country=COALESCE(excluded.location_country,jobs.location_country),location_postal_code=COALESCE(excluded.location_postal_code,jobs.location_postal_code),latitude=COALESCE(excluded.latitude,jobs.latitude),longitude=COALESCE(excluded.longitude,jobs.longitude),salary_min=COALESCE(excluded.salary_min,jobs.salary_min),salary_max=COALESCE(excluded.salary_max,jobs.salary_max),salary_currency=COALESCE(excluded.salary_currency,jobs.salary_currency),salary_interval=COALESCE(excluded.salary_interval,jobs.salary_interval),benefits=COALESCE(excluded.benefits,jobs.benefits),education_requirements=COALESCE(excluded.education_requirements,jobs.education_requirements),experience_requirements=COALESCE(excluded.experience_requirements,jobs.experience_requirements),experience_level=COALESCE(excluded.experience_level,jobs.experience_level),shift_schedule=COALESCE(excluded.shift_schedule,jobs.shift_schedule),travel_requirements=COALESCE(excluded.travel_requirements,jobs.travel_requirements),security_clearance=COALESCE(excluded.security_clearance,jobs.security_clearance),languages=CASE WHEN excluded.languages <> '[]' THEN excluded.languages ELSE jobs.languages END,requisition_id=COALESCE(excluded.requisition_id,jobs.requisition_id),apply_url=COALESCE(excluded.apply_url,jobs.apply_url),source_posted_text=COALESCE(excluded.source_posted_text,jobs.source_posted_text),source_updated_at=COALESCE(excluded.source_updated_at,jobs.source_updated_at),valid_through=COALESCE(excluded.valid_through,jobs.valid_through),raw_payload=COALESCE(excluded.raw_payload,jobs.raw_payload),status='open',published_at=COALESCE(excluded.published_at,jobs.published_at),last_seen_at=excluded.last_seen_at,closed_at=NULL,updated_at=CURRENT_TIMESTAMP;`);
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
        await page.close();
      }
      completed += 1;
      if (completed % 25 === 0) process.stdout.write(`browser fallback ${completed}/${sources.length}\n`);
    }
  }));
  await browser.close();
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(sqlPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
  const successful = results.filter((result) => result.jobs.length > 0);
  if (successful.length > 0) {
    await writeFile(sqlPath, persistenceSql(successful));
    await d1(["--file", sqlPath]);
  }
  process.stdout.write(`${JSON.stringify({ attempted: results.length, recovered: successful.length, jobs: successful.reduce((sum, result) => sum + result.jobs.length, 0) })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
