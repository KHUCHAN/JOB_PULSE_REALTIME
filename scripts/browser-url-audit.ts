import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { careerCandidates, detectUrlAdapter, isSafeCareerRecommendation, unwrapSearchResultUrl, type BrowserLink } from "../lib/url-remediation.ts";

type SeedSource = {
  id: string;
  company: string;
  postingUrl: string | null;
  adapter: "greenhouse" | "lever" | "workday" | "ashby" | "icims" | "phenom" | "dayforce" | "smartrecruiters" | "custom";
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
const outputPath = resolve(projectRoot, process.env.AUDIT_OUTPUT_PATH?.trim() || "output/playwright/url-audit/results.json");
const progressPath = resolve(projectRoot, process.env.AUDIT_PROGRESS_PATH?.trim() || "output/playwright/url-audit/progress.json");
const concurrency = Math.max(1, Number.parseInt(process.env.AUDIT_CONCURRENCY ?? "4", 10));
const JOB_SEARCH_TEXT = /\b(?:jobs?|careers?|open (?:positions|roles)|opportunities)\b/i;

const registrableDomain = (hostname: string): string => {
  const labels = hostname.replace(/^www\./i, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const tld = labels.at(-1)!;
  const secondLevel = labels.at(-2)!;
  const take = tld.length === 2 && secondLevel.length <= 3 ? 3 : 2;
  return labels.slice(-take).join(".");
};

const latestProblemSourceIds = async (): Promise<Set<string>> => {
  const requestedIds = (process.env.AUDIT_SOURCE_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (requestedIds.length > 0) return new Set(requestedIds);
  const coveragePath = process.env.AUDIT_COVERAGE_PATH?.trim();
  if (coveragePath) {
    const coverage = JSON.parse(await readFile(resolve(projectRoot, coveragePath), "utf8")) as {
      sources?: Array<{ id?: unknown; status?: unknown }>;
    };
    return new Set((coverage.sources ?? []).flatMap((source) => (
      typeof source.id === "string" && source.status !== "succeeded" ? [source.id] : []
    )));
  }
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

const searchForOfficialCareers = async (page: Page, source: SeedSource): Promise<{ url: string | null; candidates: string[] }> => {
  const query = encodeURIComponent(`${source.company} official careers jobs`);
  const response = await page.goto(`https://www.bing.com/search?q=${query}`, { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => null);
  if (!response || response.status() >= 400) return { url: null, candidates: [] };
  await page.waitForTimeout(500);
  const links = await page.locator("li.b_algo h2 a[href]").evaluateAll((anchors) => anchors.map((anchor) => ({
    href: (anchor as HTMLAnchorElement).href,
    text: (anchor.textContent ?? "").replace(/\s+/g, " ").trim(),
  })));
  const candidates = links
    .map((link) => ({ ...link, href: unwrapSearchResultUrl(link.href) }))
    .filter((link) => JOB_SEARCH_TEXT.test(link.text) && isSafeCareerRecommendation(source.company, source.postingUrl!, link.href))
    .slice(0, 5);
  for (const candidate of candidates) {
    const candidateResponse = await page.goto(candidate.href, { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => null);
    if (!candidateResponse || candidateResponse.status() >= 400) {
      const originalRoot = registrableDomain(new URL(source.postingUrl!).hostname);
      const candidateRoot = registrableDomain(new URL(candidate.href).hostname);
      if (originalRoot === candidateRoot) return { url: candidate.href, candidates: candidates.map((value) => value.href) };
      continue;
    }
    await page.waitForTimeout(700);
    if (await looksLikeJobsPage(page)) return { url: page.url(), candidates: candidates.map((value) => value.href) };
  }
  return { url: null, candidates: candidates.map((value) => value.href) };
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
      const original = new URL(source.postingUrl!);
      const parentDomain = registrableDomain(original.hostname);
      const fallbackRoots = [...new Set([original.origin, `https://${parentDomain}`, `https://www.${parentDomain}`])];
      for (const root of fallbackRoots) {
        const rootResponse = await page.goto(root, { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => null);
        await page.waitForTimeout(500);
        if (!rootResponse || rootResponse.status() >= 400) continue;
        browserStatus = rootResponse.status();
        finalUrl = page.url();
        links = await pageLinks(page);
        candidates = careerCandidates(links, finalUrl);
        if (candidates.length > 0) break;
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

    if (!recommendedUrl) {
      const searched = await searchForOfficialCareers(page, source);
      recommendedUrl = searched.url;
      candidates.push(...searched.candidates.map((href) => ({ href, text: "Search result" })));
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
    let fallbackUrl: string | null = null;
    const fallbackCandidates: string[] = [];
    try {
      const original = new URL(source.postingUrl!);
      const parentDomain = registrableDomain(original.hostname);
      for (const root of [`https://${parentDomain}`, `https://www.${parentDomain}`]) {
        const response = await page.goto(root, { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => null);
        if (!response || response.status() >= 400) continue;
        await page.waitForTimeout(500);
        const candidates = careerCandidates(await pageLinks(page), page.url());
        fallbackCandidates.push(...candidates.map((candidate) => candidate.href));
        for (const candidate of candidates.slice(0, 5)) {
          const candidateResponse = await page.goto(candidate.href, { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => null);
          if (!candidateResponse || candidateResponse.status() >= 400) continue;
          await page.waitForTimeout(700);
          if (await looksLikeJobsPage(page)) {
            fallbackUrl = page.url();
            break;
          }
        }
        if (fallbackUrl) break;
      }
    } catch {
      // Search remains the final recovery path when the corporate root is unavailable.
    }
    const searched = fallbackUrl
      ? { url: fallbackUrl, candidates: fallbackCandidates }
      : await searchForOfficialCareers(page, source).catch(() => ({ url: null, candidates: fallbackCandidates }));
    return {
      id: source.id,
      company: source.company,
      originalUrl: source.postingUrl!,
      browserStatus: null,
      finalUrl: searched.url,
      recommendedUrl: searched.url,
      adapter: detectUrlAdapter(searched.url ?? source.postingUrl!, [...resources]),
      candidateUrls: searched.candidates,
      resourceUrls: [...resources].slice(0, 50),
      error: error instanceof Error ? error.message : "Unknown browser audit error.",
    };
  } finally {
    page.off("response", onResponse);
  }
};

const inspectSourceWithDeadline = async (page: Page, source: SeedSource): Promise<BrowserAudit> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      inspectSource(page, source),
      new Promise<BrowserAudit>((resolveAudit) => {
        timeout = setTimeout(() => {
          void page.close({ runBeforeUnload: false }).catch(() => undefined);
          resolveAudit({
            id: source.id,
            company: source.company,
            originalUrl: source.postingUrl!,
            browserStatus: null,
            finalUrl: null,
            recommendedUrl: null,
            adapter: source.adapter,
            candidateUrls: [],
            resourceUrls: [],
            error: "Browser audit exceeded the 90 second per-source deadline.",
          });
        }, 90_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

async function main(): Promise<void> {
  const ids = await latestProblemSourceIds();
  const seed = JSON.parse(await readFile(resolve(projectRoot, "db/seed/sources.json"), "utf8")) as { sources: SeedSource[] };
  const allSources = seed.sources.filter((source) => source.postingUrl && ids.has(source.id));
  const previous = await readFile(outputPath, "utf8")
    .then((value) => JSON.parse(value) as { results: BrowserAudit[] })
    .catch(() => ({ results: [] as BrowserAudit[] }));
  const partial = process.env.AUDIT_RESUME_PARTIAL === "1"
    ? await readFile(`${outputPath}.partial`, "utf8")
      .then((value) => JSON.parse(value) as { results: BrowserAudit[] })
      .catch(() => ({ results: [] as BrowserAudit[] }))
    : { results: [] as BrowserAudit[] };
  const previousById = new Map([
    ...previous.results.map((result) => [result.id, result] as const),
    ...partial.results.map((result) => [result.id, result] as const),
  ]);
  const retryUnresolved = process.env.AUDIT_RETRY_UNRESOLVED === "1";
  const sources = retryUnresolved
    ? allSources.filter((source) => !previousById.get(source.id)?.recommendedUrl)
    : allSources;
  const browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }));
  const context = await browser.newContext();
  const auditedResults: BrowserAudit[] = new Array(sources.length);
  let cursor = 0;
  let completed = 0;

  await mkdir(dirname(outputPath), { recursive: true });

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < sources.length) {
      const index = cursor++;
      const page = await context.newPage();
      try {
        const source = sources[index];
        auditedResults[index] = await inspectSourceWithDeadline(page, source);
      } finally {
        if (!page.isClosed()) await Promise.race([
          page.close({ runBeforeUnload: false }).catch(() => undefined),
          new Promise((resolveClose) => setTimeout(resolveClose, 2_000)),
        ]);
      }
      completed += 1;
      if (completed % 25 === 0) {
        await writeFile(progressPath, `${JSON.stringify({ completed, total: sources.length, updatedAt: new Date().toISOString() }, null, 2)}\n`);
        await writeFile(`${outputPath}.partial`, `${JSON.stringify({ generatedAt: new Date().toISOString(), total: completed, results: auditedResults.filter(Boolean) }, null, 2)}\n`);
        process.stdout.write(`audited ${completed}/${sources.length}\n`);
      }
    }
  }));
  await browser.close();

  const auditedById = new Map(auditedResults.filter(Boolean).map((result) => [result.id, result]));
  const results = allSources
    .map((source) => auditedById.get(source.id) ?? previousById.get(source.id))
    .filter((result): result is BrowserAudit => Boolean(result));
  await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), total: results.length, results }, null, 2)}\n`);
  const resolved = results.filter((result) => result.recommendedUrl).length;
  process.stdout.write(`${JSON.stringify({ total: results.length, resolved, unresolved: results.length - resolved })}\n`);
}

await main();
