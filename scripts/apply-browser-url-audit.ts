import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuditSourceRecord, NormalizedSourceRecord } from "../lib/audit-source-normalizer.ts";
import { isSafeCareerRecommendation } from "../lib/url-remediation.ts";

type BrowserAudit = {
  id: string;
  originalUrl: string;
  recommendedUrl: string | null;
  adapter: NormalizedSourceRecord["adapter"];
};

type OfficialOverrides = {
  overrides: Record<string, { url: string | null; adapter: NormalizedSourceRecord["adapter"]; verification?: string }>;
  rejectedRecommendations: string[];
};

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seed = JSON.parse(await readFile(resolve(projectRoot, "db/seed/sources.json"), "utf8")) as { sources: NormalizedSourceRecord[] };
const audit = JSON.parse(await readFile(resolve(projectRoot, "output/playwright/url-audit/results.json"), "utf8")) as { results: BrowserAudit[] };
const official = JSON.parse(await readFile(resolve(projectRoot, "db/catalog/official-url-overrides.json"), "utf8")) as OfficialOverrides;
const byId = new Map(audit.results.map((result) => [result.id, result]));
const rejectedRecommendations = new Set(official.rejectedRecommendations);
let applied = 0;

const records: AuditSourceRecord[] = seed.sources.map((source) => {
  const result = byId.get(source.id);
  const override = official.overrides[source.id];
  const safeBrowserUrl = result?.recommendedUrl && source.postingUrl
    && result.recommendedUrl !== source.postingUrl
    && !rejectedRecommendations.has(result.recommendedUrl)
    && isSafeCareerRecommendation(source.company, source.postingUrl, result.recommendedUrl)
    ? result.recommendedUrl
    : null;
  const hasOverride = Boolean(override);
  const safeUrl = hasOverride ? override.url : safeBrowserUrl;
  if (hasOverride || safeUrl) applied += 1;
  const postingUrl = hasOverride ? override.url : (safeUrl ?? source.postingUrl);
  return {
    masterRow: source.masterRow,
    Company: source.company,
    "Ledger ID": source.id,
    postingUrl,
    talentPoolUrl: source.talentUrl,
    channel: source.channel,
    resumeUpload: source.resumeUpload === "available" ? "가능" : source.resumeUpload === "job_only" ? "지원 시 가능" : "unknown",
    jobAlerts: source.jobAlerts === "available" ? "가능" : "unknown",
    verification: override?.verification ?? source.verification.toUpperCase(),
    confidence: source.confidence.toUpperCase(),
    recommendedAction: "",
    evidenceUrl: postingUrl ?? "",
    evidenceNote: hasOverride
      ? `${postingUrl ? "Official-search-verified careers URL" : "No active company or public careers endpoint found"}; previous URL: ${source.postingUrl}`
      : safeUrl ? `Browser-verified careers URL; previous URL: ${source.postingUrl}` : "Preserved catalog source.",
    checkedAt: hasOverride || safeUrl ? "2026-08-08" : source.checkedAt,
    adapter: hasOverride ? override.adapter : safeUrl ? result!.adapter : source.adapter,
  };
});

const output = resolve(projectRoot, ".codex_tmp/browser_remediated_catalog.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(records, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ total: records.length, applied, output })}\n`);
