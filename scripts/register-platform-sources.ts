// Adds employers found on job platforms to the source catalog. Each entry in
// db/catalog/platform-sources.json must first be read successfully by crawlSource.
// The change reaches production only after the next Sites deploy.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { buildRemediatedCatalog } from "../lib/browser-url-audit-apply.ts";

const CHECKED_AT = "2026-11-03";
const seed = JSON.parse(await readFile("db/seed/sources.json", "utf8"));
const additions: Array<{ slug: string; company: string; postingUrl: string; evidenceUrl: string; evidenceNote: string; checkedAt?: string }> =
  JSON.parse(await readFile("db/catalog/platform-sources.json", "utf8"));
const { records } = buildRemediatedCatalog(seed.sources, [], { overrides: {}, rejectedRecommendations: [] });
for (const record of records) record.enabled = seed.sources.find((s: { id: string }) => s.id === record["Ledger ID"]).enabled;
let row = Math.max(...records.map((r) => r.masterRow));
for (const { slug, company, postingUrl, evidenceUrl, evidenceNote, checkedAt } of additions) {
  const id = `platform-${slug}`;
  if (records.some((r) => r["Ledger ID"] === id)) continue;
  records.push({
    masterRow: ++row, Company: company, "Ledger ID": id, postingUrl, talentPoolUrl: null,
    channel: "Official board for an employer first seen on a job platform",
    resumeUpload: "지원 시 가능", jobAlerts: "unknown", verification: "VALID_OFFICIAL_BOARD", confidence: "HIGH",
    recommendedAction: "Read public roles through the official board", evidenceUrl, evidenceNote,
    checkedAt: checkedAt ?? CHECKED_AT, enabled: true,
  });
}
await mkdir(".codex_tmp", { recursive: true });
await writeFile(".codex_tmp/platform-catalog.json", JSON.stringify(records, null, 2));
execFileSync(process.execPath, ["scripts/build-source-seed.ts", ".codex_tmp/platform-catalog.json"], { stdio: "inherit" });
