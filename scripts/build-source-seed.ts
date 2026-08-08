import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAuditRecord, type AuditSourceRecord } from "../lib/audit-source-normalizer.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPaths = process.argv.slice(2);

if (!inputPaths.length) {
  throw new Error("Pass one or more audit result JSON files to db:seed:build.");
}

const rows = (await Promise.all(inputPaths.map(async (path) => {
  const parsed = JSON.parse(await readFile(resolve(path), "utf8")) as AuditSourceRecord[];
  if (!Array.isArray(parsed)) throw new Error(`${path} is not a JSON array.`);
  return parsed;
}))).flat().map(normalizeAuditRecord).sort((a, b) => a.masterRow - b.masterRow);

const duplicateIds = rows.filter((row, index) => rows.findIndex((candidate) => candidate.id === row.id) !== index);
const duplicateMasterRows = rows.filter((row, index) => rows.findIndex((candidate) => candidate.masterRow === row.masterRow) !== index);
if (duplicateIds.length || duplicateMasterRows.length) {
  throw new Error(`Duplicate source keys: ids=${duplicateIds.length}, masterRows=${duplicateMasterRows.length}`);
}

const quote = (value: string | number | boolean | null): string => {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${value.replaceAll("'", "''")}'`;
};

const sourceColumns = [
  "id", "master_row", "company", "posting_url", "talent_url", "channel", "adapter",
  "verification", "confidence", "resume_upload", "job_alerts", "enabled", "checked_at",
] as const;

const sourceValues = rows.map((row) => [
  row.id, row.masterRow, row.company, row.postingUrl, row.talentUrl, row.channel, row.adapter,
  row.verification, row.confidence, row.resumeUpload, row.jobAlerts, row.enabled, row.checkedAt,
]);
const sourceUpdates = sourceColumns
  .filter((column) => column !== "id")
  .map((column) => `${column} = excluded.${column}`)
  .join(", ");

const talentRows = rows.filter((row) => row.talentUrl).map((row) => ({
  id: `talent-${row.id}`,
  sourceId: row.id,
  officialUrl: row.talentUrl!,
  resumeUpload: row.resumeUpload,
  jobAlerts: row.jobAlerts,
  checkedAt: row.checkedAt,
}));

const sql = [
  "PRAGMA foreign_keys = ON;",
  "BEGIN TRANSACTION;",
  ...sourceValues.map((values) => `INSERT INTO sources (${sourceColumns.join(", ")}) VALUES (${values.map(quote).join(", ")}) ON CONFLICT(id) DO UPDATE SET ${sourceUpdates};`),
  ...talentRows.map((row) => `INSERT INTO talent_targets (id, source_id, official_url, resume_upload, job_alerts, checked_at) VALUES (${[row.id, row.sourceId, row.officialUrl, row.resumeUpload, row.jobAlerts, row.checkedAt].map(quote).join(", ")}) ON CONFLICT(id) DO UPDATE SET source_id = excluded.source_id, official_url = excluded.official_url, resume_upload = excluded.resume_upload, job_alerts = excluded.job_alerts, checked_at = excluded.checked_at;`),
  "COMMIT;",
  "",
].join("\n");

const seedDir = resolve(projectRoot, "db/seed");
await mkdir(seedDir, { recursive: true });
await writeFile(resolve(seedDir, "sources.json"), `${JSON.stringify({ generatedAt: rows[0]?.checkedAt ?? null, sources: rows, talentTargets: talentRows }, null, 2)}\n`);
await writeFile(resolve(seedDir, "sources.sql"), sql);

process.stdout.write(`Built ${rows.length} sources (${rows.filter((row) => row.postingUrl).length} posting URLs) and ${talentRows.length} Talent targets.\n`);
