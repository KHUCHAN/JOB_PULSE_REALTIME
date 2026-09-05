import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSitesMigrations } from "./sites-migrations";
import { sitesSchemaMigrationFiles } from "./sites-vite-plugin";

describe("Sites migration packaging", () => {
  it("repairs fresh, partially applied and completed retention DDL without data loss", async () => {
    const initial = await Promise.all(["0140_job_retention_archive.sql", "0141_job_retention_index.sql", "0142_job_identifier_search.sql"].map(file => readFile(join(process.cwd(), "drizzle", file), "utf8")));
    const repair = await readFile(join(process.cwd(), "drizzle/0143_retention_deployment_repair.sql"), "utf8");
    for (const applied of [0, 1, 2, 3]) {
      const output = execFileSync("sqlite3", ["-json", "-batch", ":memory:"], {encoding:"utf8", input: [
        "CREATE TABLE jobs(id TEXT PRIMARY KEY, published_at TEXT, requisition_id TEXT, external_id TEXT);",
        "INSERT INTO jobs VALUES ('preserve','2026-09-01','R-284879','94172495052972742');",
        ...initial.slice(0, applied), repair, repair,
        "SELECT count(*) AS jobs FROM jobs;",
        "SELECT count(*) AS indexes FROM sqlite_master WHERE type='index' AND (name LIKE 'expired_job_archive_%_idx' OR name IN ('jobs_retention_published_idx','jobs_requisition_id_nocase_idx','jobs_external_id_nocase_idx'));",
      ].join("\n")});
      expect(output).toContain('"jobs":1');
      expect(output).toContain('"indexes":7');
    }
  });
  it("ships the AI/data topic schema without catalog refresh data migrations", () => {
    expect(sitesSchemaMigrationFiles).toContain("0037_ai_data_job_topics.sql");
    expect(sitesSchemaMigrationFiles).toContain("0038_job_topic_backfill_index.sql");
    expect(sitesSchemaMigrationFiles).toContain("0039_job_filter_options_cache.sql");
    expect(sitesSchemaMigrationFiles).toContain("0040_indexed_job_programs.sql");
    expect(sitesSchemaMigrationFiles).toContain("0129_repair_crawler_sources_and_query_indexes.sql");
    expect(sitesSchemaMigrationFiles).toContain("0143_retention_deployment_repair.sql");
    expect(sitesSchemaMigrationFiles.some((file) => file.includes("refresh_sources"))).toBe(false);
  });

  it("keeps schema migrations and splits only the final catalog into bounded files", async () => {
    const root = await mkdtemp(join(tmpdir(), "job-pulse-sites-"));
    const source = join(root, "source");
    const output = join(root, "output");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(source));
    await writeFile(join(source, "0000_schema.sql"), "CREATE TABLE sources(id TEXT PRIMARY KEY);\n");
    await writeFile(join(source, "0026_rich.sql"), "ALTER TABLE sources ADD COLUMN company TEXT;\n");
    await writeFile(join(source, "0027_catalog.sql"), [
      "BEGIN;",
      "INSERT INTO sources VALUES ('a', '" + "x".repeat(40) + "');",
      "INSERT INTO sources VALUES ('b', '" + "y".repeat(40) + "');",
      "INSERT INTO sources VALUES ('c', '" + "z".repeat(40) + "');",
      "COMMIT;",
    ].join("\n"));

    await buildSitesMigrations({
      sourceDirectory: source,
      outputDirectory: output,
      schemaFiles: ["0000_schema.sql", "0026_rich.sql"],
      catalogFile: "0027_catalog.sql",
      maxBytes: 130,
    });

    const files = await readdir(output);
    expect(files.slice(0, 2)).toEqual(["0000_schema.sql", "0026_rich.sql"]);
    expect(files.some((file) => file.includes("catalog"))).toBe(true);
    for (const file of files) {
      const sql = await readFile(join(output, file), "utf8");
      expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(130);
    }
    expect((await Promise.all(files.map((file) => readFile(join(output, file), "utf8")))).join("\n"))
      .toContain("INSERT INTO sources VALUES ('c'");
  });

  it("keeps default deployment scripts below the Sites D1 request ceiling", async () => {
    const root = await mkdtemp(join(tmpdir(), "job-pulse-sites-limit-"));
    const source = join(root, "source");
    const output = join(root, "output");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(source));
    await writeFile(join(source, "0000_schema.sql"), "CREATE TABLE sources(id TEXT PRIMARY KEY);\n");
    const rows = Array.from({ length: 6 }, (_, index) =>
      `INSERT INTO sources VALUES ('${index}${"x".repeat(19_000)}');`);
    await writeFile(join(source, "0027_catalog.sql"), `BEGIN;\n${rows.join("\n")}\nCOMMIT;\n`);

    await buildSitesMigrations({
      sourceDirectory: source,
      outputDirectory: output,
      schemaFiles: ["0000_schema.sql"],
      catalogFile: "0027_catalog.sql",
    });

    for (const file of await readdir(output)) {
      expect(Buffer.byteLength(await readFile(join(output, file), "utf8"))).toBeLessThanOrEqual(30_000);
    }
  });

  it("can package schema without embedding catalog data", async () => {
    const root = await mkdtemp(join(tmpdir(), "job-pulse-sites-schema-"));
    const source = join(root, "source");
    const output = join(root, "output");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(source));
    await writeFile(join(source, "0000_schema.sql"), "CREATE TABLE sources(id TEXT PRIMARY KEY);\n");

    await buildSitesMigrations({
      sourceDirectory: source,
      outputDirectory: output,
      schemaFiles: ["0000_schema.sql"],
    });

    expect(await readdir(output)).toEqual(["0000_schema.sql"]);
  });
});
