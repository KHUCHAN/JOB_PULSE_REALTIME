import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NormalizedSourceRecord } from "../lib/audit-source-normalizer.ts";
import { buildRemediatedCatalog, type BrowserUrlAuditResult, type OfficialUrlOverrides } from "../lib/browser-url-audit-apply.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seed = JSON.parse(await readFile(resolve(projectRoot, "db/seed/sources.json"), "utf8")) as { sources: NormalizedSourceRecord[] };
const audit = JSON.parse(await readFile(resolve(projectRoot, "output/playwright/url-audit/results.json"), "utf8")) as { results: BrowserUrlAuditResult[] };
const official = JSON.parse(await readFile(resolve(projectRoot, "db/catalog/official-url-overrides.json"), "utf8")) as OfficialUrlOverrides;
const { records, applied } = buildRemediatedCatalog(seed.sources, audit.results, official);

const output = resolve(projectRoot, ".codex_tmp/browser_remediated_catalog.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(records, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ total: records.length, applied, output })}\n`);
