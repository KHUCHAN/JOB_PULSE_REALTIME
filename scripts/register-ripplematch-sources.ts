import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { buildRemediatedCatalog } from "../lib/browser-url-audit-apply.ts";
const seed = JSON.parse(await readFile("db/seed/sources.json", "utf8"));
const additions: string[][] = JSON.parse(await readFile("db/catalog/ripplematch-sources.json", "utf8"));
const { records } = buildRemediatedCatalog(seed.sources.filter((s: { id: string }) => !["ripplematch-moodys", "ripplematch-guardian-life-insurance"].includes(s.id)), [], { overrides: {}, rejectedRecommendations: [] });
for (const record of records) record.enabled = seed.sources.find((s: { id: string }) => s.id === record["Ledger ID"]).enabled;
let row = Math.max(...records.map(r => r.masterRow));
for (const [slug, company] of additions) {
  const id = `ripplematch-${slug}`;
  if (records.some(r => r["Ledger ID"] === id)) continue;
  records.push({ masterRow: ++row, Company: company, "Ledger ID": id,
    postingUrl: `https://app.ripplematch.com/v2/public/company/${slug}`, talentPoolUrl: null,
    adapter: "custom", channel: "Employer-hosted RippleMatch public recruiting profile; supplemental to primary ATS",
    resumeUpload: "지원 시 가능", jobAlerts: "unknown", verification: "VALID_PUBLIC_EMPLOYER_PROFILE",
    confidence: "HIGH", recommendedAction: "Read public roles and verify direct-apply isDisabledRole=false",
    evidenceUrl: "https://ripplematch.com/jobs/data-science-majors/",
    evidenceNote: "Employer identity and application-state API verified during 2026-09-14 audit. Events are not jobs.",
    checkedAt: "2026-09-14", enabled: true });
}
await mkdir(".codex_tmp", { recursive: true });
await writeFile(".codex_tmp/ripplematch-catalog.json", JSON.stringify(records, null, 2));
execFileSync(process.execPath, ["scripts/build-source-seed.ts", ".codex_tmp/ripplematch-catalog.json"], { stdio: "inherit" });
