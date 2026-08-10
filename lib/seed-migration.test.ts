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
    expect(currentJournal.entries.at(-1)).toMatchObject({
      idx: 45,
      tag: "0045_tech_job_areas_regions",
    });
  });
});
