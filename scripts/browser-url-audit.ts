import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { careerCandidates, detectUrlAdapter, type BrowserLink } from "../lib/url-remediation.ts";

type SeedSource = {
  id: string;
  company: string;
  postingUrl: string | null;
  adapter: "greenhouse" | "lever" | "workday" | "icims" | "phenom" | "custom";
};

type BrowserAudit = {
  id: string;
  company: string;
  originalUrl: string;
  browserStatus: number | null;
  finalUrl: string | null;
  recommendedUrl: string | null;
  adapter: SeedSource["adapter"];
  candidateUrls: string[];
  resourceUrls: string[];
  error: string | null;
};

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = resolve(projectRoot, "node_modules/.bin/wrangler");
const outputPath = resolve(projectRoot, "output/playwright/url-audit/results.json");
const progressPath = resolve(projectRoot, "output/playwright/url-audit/progress.json");
const concurrency = 8;

const latestProblemSourceIds = async (): Promise<Set<string>> => {
  const sql = `WITH latest AS (
    SELECT source_id, status, ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY started_at DESC) AS row_number
    FROM crawl_runs
  ) SELECT source_id FROM latest WHERE row_number = 1 AND status IN ('blocked', 'failed')`;
  const { stdout } = await execFileAsync(wrangler, [
    "d1", "execute", "site-creator-d1", "--config", "wrangler.local.jsonc", "--local",
    "--persist-to", ".wrangler/state", "--json", "--command", sql,
  ], { cwd: projectRoot, maxBuffer: 10 * 1024 * 1024 });
  const parsed = JSON.parse(stdout) as Array<{ results: Array<{ source_id: string }> }>;
  return new Set(parsed.flatMap((result) => result.results).map((row) => row.source_id));
};

const pageLinks = async (page: Page): Promise<BrowserLink[]> => page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => ({
  href: (anchor as HTMLAnchorElement).href,
  text: (anchor.textContent ?? "").replace(/\s+/g, " ").trim(),
})));

const looksLikeJobsPage = async (page: Page): Promise<boolean> => {
  const value = `${await page.title()} ${(await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "")).slice(0, 20_000)}`;
  return /\b(?:search jobs?|job results?|open positions|career opportunities|apply now|job id|posted date)\b/i.test(value);
};

const inspectSource = async (page: Page, source: SeedSource): Promise<BrowserAudit> => {
  const resources = new Set<string>();
  const onResponse = (response: { url(): string }) => {
    const url = response.url();
    if (/greenhouse|lever|workday|smartrecruiters|ashby|icims|jobvite|phenom|\/api\/.*job|\/jobs?\b/i.test(url)) resources.add(url);
  };
  page.on("response", onResponse);
  try {
    const response = await page.goto(source.postingUrl!, { waitUntil: "domcontentloaded", timeout: 12_000 });
    await page.waitForTimeout(700);
    let browserStatus = response?.status() ?? null;
    let finalUrl = page.url();
    let links = await pageLinks(page);
    let candidates = careerCandidates(links, finalUrl);
    const originalLooksValid = browserStatus !== null && browserStatus < 400 && await looksLikeJobsPage(page);

    if (!originalLooksValid && candidates.length === 0) {
      const root = new URL(source.postingUrl!).origin;
      const rootResponse = await page.goto(root, { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => null);
      await page.waitForTimeout(500);
      if (rootResponse) {
        browserStatus = rootResponse.status();
        finalUrl = page.url();
        links = await pageLinks(page);
        candidates = careerCandidates(links, finalUrl);
      }
    }

    let recommendedUrl = originalLooksValid ? finalUrl : null;
    for (const candidate of candidates.slice(0, 5)) {
      if (recommendedUrl) break;
      const candidateResponse = await page.goto(candidate.href, { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => null);
      if (!candidateResponse || candidateResponse.status() >= 400) continue;
      await page.waitForTimeout(700);
      if (await looksLikeJobsPage(page)) recommendedUrl = page.url();
    }

    const resourceUrls = [...resources].slice(0, 50);
    return {
      id: source.id,
      company: source.company,
      originalUrl: source.postingUrl!,
      browserStatus,
      finalUrl,
      recommendedUrl,
      adapter: detectUrlAdapter(recommendedUrl ?? finalUrl, resourceUrls),
      candidateUrls: candidates.slice(0, 10).map((candidate) => candidate.href),
      resourceUrls,
      error: null,
    };
  } catch (error) {
    return {
      id: source.id,
      company: source.company,
      originalUrl: source.postingUrl!,
      browserStatus: null,
      finalUrl: null,
      recommendedUrl: null,
      adapter: source.adapter,
      candidateUrls: [],
      resourceUrls: [...resources].slice(0, 50),
      error: error instanceof Error ? error.message : "Unknown browser audit error.",
    };
  } finally {
    page.off("response", onResponse);
  }
};

async function main(): Promise<void> {
  const ids = await latestProblemSourceIds();
  const seed = JSON.parse(await readFile(resolve(projectRoot, "db/seed/sources.json"), "utf8")) as { sources: SeedSource[] };
  const sources = seed.sources.filter((source) => source.postingUrl && ids.has(source.id));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: "JobPulseUrlAuditor/1.0 (+https://job-pulse.local)" });
  const results: BrowserAudit[] = new Array(sources.length);
  let cursor = 0;
  let completed = 0;

  await mkdir(dirname(outputPath), { recursive: true });

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < sources.length) {
      const index = cursor++;
      const page = await context.newPage();
      try {
        results[index] = await inspectSource(page, sources[index]);
      } finally {
        await page.close();
      }
      completed += 1;
      if (completed % 25 === 0) {
        await writeFile(progressPath, `${JSON.stringify({ completed, total: sources.length, updatedAt: new Date().toISOString() }, null, 2)}\n`);
        process.stdout.write(`audited ${completed}/${sources.length}\n`);
      }
    }
  }));
  await browser.close();

  await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), total: results.length, results }, null, 2)}\n`);
  const resolved = results.filter((result) => result.recommendedUrl).length;
  process.stdout.write(`${JSON.stringify({ total: results.length, resolved, unresolved: results.length - resolved })}\n`);
}

await main();
