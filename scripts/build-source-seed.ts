import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAuditRecord, type AuditSourceRecord } from "../lib/audit-source-normalizer.ts";
import {
  advanceSeedSnapshot,
  planSeedMigration,
  type DrizzleJournal,
} from "../lib/seed-migration.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const createMigration = process.argv.includes("--migration");
const inputPaths = process.argv.slice(2).filter((argument) => argument !== "--migration");

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

let migrationMessage = "";
if (createMigration) {
  const migrationDir = resolve(projectRoot, "drizzle");
  const metaDir = resolve(migrationDir, "meta");
  const journalPath = resolve(metaDir, "_journal.json");
  const catalogMigrationFiles = (await readdir(migrationDir))
    .filter((name) => name === "0001_seed_sources.sql" || /^\d{4}_refresh_sources_.+\.sql$/.test(name))
    .sort();
  const catalogSqlHistory = await Promise.all(catalogMigrationFiles.map((name) => readFile(resolve(migrationDir, name), "utf8")));
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as DrizzleJournal;
  const plan = planSeedMigration({ journal, catalogSqlHistory, nextSql: sql, now: new Date() });

  if (plan) {
    const previousIndex = journal.entries.at(-1)?.idx;
    if (previousIndex === undefined) throw new Error("Cannot create a catalog migration without a Drizzle snapshot.");

    const previousSnapshotPath = resolve(metaDir, `${String(previousIndex).padStart(4, "0")}_snapshot.json`);
    const previousSnapshot = JSON.parse(await readFile(previousSnapshotPath, "utf8"));
    const nextSnapshotPath = resolve(metaDir, `${String(plan.snapshotIndex).padStart(4, "0")}_snapshot.json`);

    await writeFile(nextSnapshotPath, `${JSON.stringify(advanceSeedSnapshot(previousSnapshot, randomUUID()), null, 2)}\n`, { flag: "wx" });
    await writeFile(resolve(migrationDir, plan.fileName), sql, { flag: "wx" });
    await writeFile(journalPath, `${JSON.stringify(plan.journal, null, 2)}\n`);
    migrationMessage = ` Created immutable migration ${plan.fileName}.`;
  } else {
    migrationMessage = " Catalog SQL already has an immutable migration; no new migration created.";
  }
}

process.stdout.write(`Built ${rows.length} sources (${rows.filter((row) => row.postingUrl).length} posting URLs) and ${talentRows.length} Talent targets.${migrationMessage}\n`);
