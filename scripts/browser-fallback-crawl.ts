import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { jobsFromBrowserAnchors, type BrowserAnchor } from "../lib/browser-job-extractor.ts";
import { anchorsFromHtml, crawlSource, extractJobsFromHtml, type CrawledJob, type CrawlSource } from "../lib/crawler.ts";
import { careerCandidates } from "../lib/url-remediation.ts";

type BrowserFallbackResult = {
  source: CrawlSource;
  status: number | null;
  finalUrl: string | null;
  jobs: CrawledJob[];
  error: string | null;
};

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = resolve(projectRoot, "node_modules/.bin/wrangler");
const outputPath = resolve(projectRoot, "output/playwright/browser-fallback/results.json");
const sqlPath = resolve(projectRoot, ".codex_tmp/browser-fallback.sql");
const concurrency = 4;
const limit = Number.parseInt(process.env.BROWSER_FALLBACK_LIMIT ?? "500", 10);
const headless = process.env.BROWSER_FALLBACK_HEADFUL !== "1";

const d1 = async (args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync(wrangler, [
    "d1", "execute", "site-creator-d1", "--config", "wrangler.local.jsonc", "--local",
    "--persist-to", ".wrangler/state", "--json", ...args,
  ], { cwd: projectRoot, maxBuffer: 100 * 1024 * 1024 });
  return stdout;
};

const problemSources = async (): Promise<CrawlSource[]> => {
  const sql = `WITH latest AS (
    SELECT source_id, status, ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY started_at DESC) row_number
    FROM crawl_runs
  ) SELECT s.id, s.company, s.posting_url, s.adapter
    FROM latest l JOIN sources s ON s.id = l.source_id
    WHERE l.row_number = 1 AND l.status IN ('blocked', 'failed')
      AND s.enabled = 1 AND s.posting_url IS NOT NULL
    ORDER BY s.company LIMIT ${Number.isFinite(limit) ? Math.max(1, limit) : 500}`;
  const parsed = JSON.parse(await d1(["--command", sql])) as Array<{ results: Array<{ id: string; company: string; posting_url: string; adapter: CrawlSource["adapter"] }> }>;
  return parsed.flatMap((value) => value.results).map((row) => ({
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
      return { source, status: direct.responseStatus, finalUrl: source.postingUrl, jobs: direct.jobs, error: null };
    }
    const http1Jobs = await jobsViaHttp1(source);
    if (http1Jobs.length > 0) {
      return { source, status: 200, finalUrl: source.postingUrl, jobs: http1Jobs, error: null };
    }
    const response = await page.goto(source.postingUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Client-rendered ATS pages such as Dayforce populate job cards after hydration.
    await page.waitForTimeout(3_000);
    let jobs = await jobsOnPage(page, source);
    if (jobs.length === 0 && response && response.status() < 400) {
      const candidates = careerCandidates(await anchorsOnPage(page), page.url());
      for (const candidate of candidates.slice(0, 2)) {
        const candidateResponse = await page.goto(candidate.href, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
        if (!candidateResponse || candidateResponse.status() >= 400) continue;
        await page.waitForTimeout(3_000);
        jobs = await jobsOnPage(page, source);
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

const persistenceSql = (results: BrowserFallbackResult[]): string => {
  const now = new Date().toISOString();
  const next = new Date(Date.now() + 2 * 60 * 60 * 1_000).toISOString();
  const statements = ["PRAGMA foreign_keys = ON;", "BEGIN TRANSACTION;"];
  for (const result of results.filter((value) => value.jobs.length > 0)) {
    for (const job of result.jobs) {
      const values = [randomUUID(), result.source.id, job.externalId, job.title, job.company, job.location, job.arrangement, job.employmentType, job.summary, job.officialUrl];
      statements.push(`INSERT INTO jobs (id, source_id, external_id, title, company, location, arrangement, employment_type, summary, official_url, status, published_at, first_seen_at, last_seen_at) VALUES (${values.map(quote).join(", ")}, 'open', ${quote(job.publishedAt)}, ${quote(now)}, ${quote(now)}) ON CONFLICT(source_id, official_url) DO UPDATE SET external_id=excluded.external_id,title=excluded.title,company=excluded.company,location=excluded.location,arrangement=excluded.arrangement,employment_type=excluded.employment_type,summary=excluded.summary,status='open',published_at=excluded.published_at,last_seen_at=excluded.last_seen_at,closed_at=NULL,updated_at=CURRENT_TIMESTAMP;`);
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

await main();
