import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { advanceSeedSnapshot, catalogDeltaSql, planSeedMigration, versionedCatalogSql } from "./seed-migration";

const journal = {
  version: "7",
  dialect: "sqlite",
  entries: [
    { idx: 0, version: "6", when: 100, tag: "0000_schema", breakpoints: true },
    { idx: 1, version: "6", when: 200, tag: "0001_seed_sources", breakpoints: true },
  ],
};

describe("planSeedMigration", () => {
  it("does not create a migration when the catalog SQL is already committed", () => {
    expect(planSeedMigration({
      journal,
      catalogSqlHistory: ["INSERT INTO sources VALUES ('same');\n"],
      nextSql: "INSERT INTO sources VALUES ('same');\n",
      now: new Date("2026-08-08T12:34:56Z"),
    })).toBeNull();
  });

  it("compares catalog versions when a migration contains only changed rows", () => {
    expect(planSeedMigration({
      journal,
      catalogSqlHistory: ["-- catalog-version: sha256:same\nINSERT INTO sources VALUES ('changed');\n"],
      nextSql: versionedCatalogSql("INSERT INTO sources VALUES ('full');\n", "sha256:same"),
      now: new Date("2026-08-08T12:34:56Z"),
    })).toBeNull();
  });

  it("creates the next immutable migration and journal entry for changed catalog SQL", () => {
    expect(planSeedMigration({
      journal,
      catalogSqlHistory: ["INSERT INTO sources VALUES ('old');\n"],
      nextSql: "INSERT INTO sources VALUES ('new');\n",
      now: new Date("2026-08-08T12:34:56Z"),
    })).toEqual({
      fileName: "0002_refresh_sources_20260808123456.sql",
      journal: {
        ...journal,
        entries: [
          ...journal.entries,
          {
            idx: 2,
            version: "6",
            when: 1786192496000,
            tag: "0002_refresh_sources_20260808123456",
            breakpoints: true,
          },
        ],
      },
      snapshotIndex: 2,
      previousSnapshotIndex: 1,
    });
  });

  it("advances from the latest migration prefix when journal indexes have a numbering gap", () => {
    const gappedJournal = {
      ...journal,
      entries: [
        journal.entries[0],
        { ...journal.entries[1], tag: "0002_schema_after_gap" },
      ],
    };

    expect(planSeedMigration({
      journal: gappedJournal,
      catalogSqlHistory: ["INSERT INTO sources VALUES ('old');\n"],
      nextSql: "INSERT INTO sources VALUES ('new');\n",
      now: new Date("2026-08-08T12:34:56Z"),
    })).toEqual(expect.objectContaining({
      fileName: "0003_refresh_sources_20260808123456.sql",
      snapshotIndex: 3,
      previousSnapshotIndex: 2,
      journal: expect.objectContaining({
        entries: expect.arrayContaining([expect.objectContaining({ idx: 2, tag: "0003_refresh_sources_20260808123456" })]),
      }),
    }));
  });

  it("creates a new migration when reverting to catalog SQL from an older migration", () => {
    expect(planSeedMigration({
      journal,
      catalogSqlHistory: [
        "INSERT INTO sources VALUES ('original');\n",
        "INSERT INTO sources VALUES ('current');\n",
      ],
      nextSql: "INSERT INTO sources VALUES ('original');\n",
      now: new Date("2026-08-08T12:34:56Z"),
    })?.fileName).toBe("0002_refresh_sources_20260808123456.sql");
  });
});

describe("catalogDeltaSql", () => {
  it("emits only new or changed upserts and carries the full-catalog version", () => {
    expect(catalogDeltaSql(
      "INSERT INTO sources VALUES ('same');\nINSERT INTO sources VALUES ('old');\n",
      "INSERT INTO sources VALUES ('same');\nINSERT INTO sources VALUES ('new');\n",
      "sha256:next",
    )).toBe("-- catalog-version: sha256:next\nINSERT INTO sources VALUES ('new');\n");
  });
});

describe("advanceSeedSnapshot", () => {
  it("preserves the schema while advancing Drizzle's snapshot chain", () => {
    expect(advanceSeedSnapshot({
      id: "old-id",
      prevId: "older-id",
      version: "6",
      dialect: "sqlite",
      tables: { sources: { name: "sources" } },
    }, "new-id")).toEqual({
      id: "new-id",
      prevId: "old-id",
      version: "6",
      dialect: "sqlite",
      tables: { sources: { name: "sources" } },
    });
  });
});

describe("tech job area and region migration", () => {
  const drizzlePath = resolve(process.cwd(), "drizzle");

  it("adds region, area backfill state, and the indexed region search path", () => {
    const sql = readFileSync(resolve(drizzlePath, "0045_tech_job_areas_regions.sql"), "utf8");

    expect(sql).toContain('ALTER TABLE `jobs` ADD `location_region` text');
    expect(sql).toContain('ALTER TABLE `jobs` ADD `area_classified_at` text');
    expect(sql).toContain('CREATE INDEX `jobs_status_location_region_seen_idx`');
  });

  it("chains the immutable snapshot and journal after migration 0044", () => {
    const previous = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0044_snapshot.json"), "utf8"));
    const current = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0045_snapshot.json"), "utf8"));
    const currentJournal = JSON.parse(readFileSync(resolve(drizzlePath, "meta/_journal.json"), "utf8"));

    expect(current.prevId).toBe(previous.id);
    expect(currentJournal.entries.find((entry: { tag: string }) => entry.tag === "0045_tech_job_areas_regions")).toMatchObject({
      idx: 45,
      tag: "0045_tech_job_areas_regions",
    });
  });
});

describe("large catalog US scope migration", () => {
  const drizzlePath = resolve(process.cwd(), "drizzle");

  it("resets old page cursors and schedules every newly scoped source", () => {
    const sql = readFileSync(resolve(drizzlePath, "0100_large_catalog_us_scope.sql"), "utf8");
    const sourceIds = JSON.parse(sql.match(/json_each\('(\[[^']+\])'\)/)?.[1] ?? "[]") as string[];

    expect(sourceIds).toHaveLength(103);
    expect(new Set(sourceIds).size).toBe(103);
    expect(sql).toContain("DELETE FROM catalog_state");
    expect(sql).toContain("'crawl_page_checkpoint:' || value");
    expect(sql).toContain("UPDATE sources SET next_crawl_at = CURRENT_TIMESTAMP");
    expect(sql).toContain("'crawler_scope_policy', 'large-us-v2'");
  });

  it("applies cleanly and leaves unrelated checkpoints untouched", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE catalog_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
      CREATE TABLE sources (id TEXT PRIMARY KEY, next_crawl_at TEXT, updated_at TEXT);
      INSERT INTO sources (id, next_crawl_at) VALUES
        ('p5-0586-eaton', '2099-01-01T00:00:00.000Z'),
        ('p5-0656-lockheed-martin', '2099-01-01T00:00:00.000Z');
      INSERT INTO catalog_state (key, value) VALUES
        ('crawl_page_checkpoint:p5-0586-eaton', '{}'),
        ('crawl_page_checkpoint:p5-0656-lockheed-martin', '{}');
    `);
    sqlite.exec(readFileSync(resolve(drizzlePath, "0100_large_catalog_us_scope.sql"), "utf8"));

    expect(sqlite.prepare("SELECT count(*) AS count FROM catalog_state WHERE key = 'crawl_page_checkpoint:p5-0586-eaton'").get()).toEqual({ count: 1 });
    expect(sqlite.prepare("SELECT count(*) AS count FROM catalog_state WHERE key = 'crawl_page_checkpoint:p5-0656-lockheed-martin'").get()).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT next_crawl_at < '2099' AS due FROM sources WHERE id = 'p5-0656-lockheed-martin'").get()).toEqual({ due: 1 });
    expect(sqlite.prepare("SELECT value FROM catalog_state WHERE key = 'crawler_scope_policy'").get()).toEqual({ value: "large-us-v2" });
  });

  it("chains the immutable scope snapshot through the subsequent catalog refresh", () => {
    const previous = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0099_snapshot.json"), "utf8"));
    const current = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0100_snapshot.json"), "utf8"));
    const refreshed = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0101_snapshot.json"), "utf8"));
    const currentJournal = JSON.parse(readFileSync(resolve(drizzlePath, "meta/_journal.json"), "utf8"));

    expect(current.prevId).toBe(previous.id);
    expect(refreshed.prevId).toBe(current.id);
    expect(currentJournal.entries.find((entry: { tag: string }) => entry.tag === "0100_large_catalog_us_scope")).toMatchObject({
      idx: 100,
      tag: "0100_large_catalog_us_scope",
    });
    expect(currentJournal.entries.at(-1)).toMatchObject({
      idx: 101,
      tag: "0101_refresh_sources_20260815124833",
    });
  });
});
