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
    )).toBe([
      "-- catalog-version: sha256:next",
      "INSERT INTO sources VALUES ('new');",
      "UPDATE jobs SET status = 'closed', closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE status = 'open' AND source_id IN (SELECT id FROM sources WHERE enabled = 0);",
      "UPDATE job_matches SET is_active = 0 WHERE is_active = 1 AND job_id IN (SELECT jobs.id FROM jobs JOIN sources ON sources.id = jobs.source_id WHERE sources.enabled = 0);",
      "",
    ].join("\n"));
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

  it("clears future ATS timestamps without changing observed dates", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE jobs (id TEXT PRIMARY KEY, published_at TEXT, source_updated_at TEXT, updated_at TEXT);
      INSERT INTO jobs VALUES
        ('future', '2099-01-01T00:00:00.000Z', '2099-01-02T00:00:00.000Z', NULL),
        ('past', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', NULL);
    `);
    sqlite.exec(readFileSync(resolve(drizzlePath, "0122_reject_future_job_timestamps.sql"), "utf8"));

    expect(sqlite.prepare("SELECT published_at, source_updated_at FROM jobs WHERE id = 'future'").get())
      .toEqual({ published_at: null, source_updated_at: null });
    expect(sqlite.prepare("SELECT published_at, source_updated_at FROM jobs WHERE id = 'past'").get())
      .toEqual({ published_at: "2026-01-01T00:00:00.000Z", source_updated_at: "2026-01-02T00:00:00.000Z" });
  });

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

  it("chains the immutable scope snapshot through the catalog refreshes and requeue", () => {
    const previous = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0099_snapshot.json"), "utf8"));
    const current = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0100_snapshot.json"), "utf8"));
    const refreshed = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0101_snapshot.json"), "utf8"));
    const requeued = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0102_snapshot.json"), "utf8"));
    const wayfairRefresh = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0103_snapshot.json"), "utf8"));
    const salesforceRefresh = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0104_snapshot.json"), "utf8"));
    const cincinnatiRefresh = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0105_snapshot.json"), "utf8"));
    const molsonCoorsRefresh = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0106_snapshot.json"), "utf8"));
    const deutscheBankRefresh = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0107_snapshot.json"), "utf8"));
    const communityHealthRefresh = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0108_snapshot.json"), "utf8"));
    const pennMedicineRefresh = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0109_snapshot.json"), "utf8"));
    const officialCatalogRefresh = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0110_snapshot.json"), "utf8"));
    const jobsynFoxJobviteRefresh = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0111_snapshot.json"), "utf8"));
    const dardenSolarEdgeRefresh = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0112_snapshot.json"), "utf8"));
    const durableAlertIdentity = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0113_snapshot.json"), "utf8"));
    const verifiedPostingLinkRepairs = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0114_snapshot.json"), "utf8"));
    const catalogRefresh115 = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0115_snapshot.json"), "utf8"));
    const catalogRefresh116 = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0116_snapshot.json"), "utf8"));
    const catalogRefresh117 = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0117_snapshot.json"), "utf8"));
    const catalogRefresh118 = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0118_snapshot.json"), "utf8"));
    const catalogRefresh119 = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0119_snapshot.json"), "utf8"));
    const catalogRefresh120 = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0120_snapshot.json"), "utf8"));
    const catalogRefresh121 = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0121_snapshot.json"), "utf8"));
    const futureTimestampRepair = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0122_snapshot.json"), "utf8"));
    const duplicateSourceRetirement = JSON.parse(readFileSync(resolve(drizzlePath, "meta/0123_snapshot.json"), "utf8"));
    const currentJournal = JSON.parse(readFileSync(resolve(drizzlePath, "meta/_journal.json"), "utf8"));

    expect(current.prevId).toBe(previous.id);
    expect(refreshed.prevId).toBe(current.id);
    expect(requeued.prevId).toBe(refreshed.id);
    expect(wayfairRefresh.prevId).toBe(requeued.id);
    expect(salesforceRefresh.prevId).toBe(wayfairRefresh.id);
    expect(cincinnatiRefresh.prevId).toBe(salesforceRefresh.id);
    expect(molsonCoorsRefresh.prevId).toBe(cincinnatiRefresh.id);
    expect(deutscheBankRefresh.prevId).toBe(molsonCoorsRefresh.id);
    expect(communityHealthRefresh.prevId).toBe(deutscheBankRefresh.id);
    expect(pennMedicineRefresh.prevId).toBe(communityHealthRefresh.id);
    expect(officialCatalogRefresh.prevId).toBe(pennMedicineRefresh.id);
    expect(jobsynFoxJobviteRefresh.prevId).toBe(officialCatalogRefresh.id);
    expect(dardenSolarEdgeRefresh.prevId).toBe(jobsynFoxJobviteRefresh.id);
    expect(durableAlertIdentity.prevId).toBe(dardenSolarEdgeRefresh.id);
    expect(verifiedPostingLinkRepairs.prevId).toBe(durableAlertIdentity.id);
    expect(catalogRefresh115.prevId).toBe(verifiedPostingLinkRepairs.id);
    expect(catalogRefresh116.prevId).toBe(catalogRefresh115.id);
    expect(catalogRefresh117.prevId).toBe(catalogRefresh116.id);
    expect(catalogRefresh118.prevId).toBe(catalogRefresh117.id);
    expect(catalogRefresh119.prevId).toBe(catalogRefresh118.id);
    expect(catalogRefresh120.prevId).toBe(catalogRefresh119.id);
    expect(catalogRefresh121.prevId).toBe(catalogRefresh120.id);
    expect(futureTimestampRepair.prevId).toBe(catalogRefresh121.id);
    expect(duplicateSourceRetirement.prevId).toBe(futureTimestampRepair.id);
    expect(durableAlertIdentity.tables).toHaveProperty("notification_identity_history");
    expect(durableAlertIdentity.tables.jobs.columns).toHaveProperty("alert_discovered_after_baseline");
    expect(currentJournal.entries.find((entry: { tag: string }) => entry.tag === "0100_large_catalog_us_scope")).toMatchObject({
      idx: 100,
      tag: "0100_large_catalog_us_scope",
    });
    expect(currentJournal.entries.at(-1)).toMatchObject({
      idx: 123,
      tag: "0123_refresh_sources_20260825131831",
    });
  });

  it("retires only the duplicate or acquired source identities and their stale matches", () => {
    const sql = readFileSync(resolve(drizzlePath, "0123_refresh_sources_20260825131831.sql"), "utf8");
    const retiredIds = [...sql.matchAll(/VALUES \('([^']+)'/g)].map((match) => match[1]);

    expect(retiredIds).toEqual([
      "p4-0331-progressive",
      "p4-0455-logrhythm",
      "p5-0601-galileo-ai",
    ]);
    expect(sql).toContain("UPDATE jobs SET status = 'closed'");
    expect(sql).toContain("UPDATE job_matches SET is_active = 0");
    expect(sql).not.toContain("'p5-0896-exact-sciences'");
    expect(sql).not.toContain("'p5-0715-replicate'");
    expect(sql).not.toContain("'p2-0098-discover'");
  });

  it("requeues every repaired source for the server-owned batch", () => {
    const sql = readFileSync(resolve(drizzlePath, "0102_requeue_recovered_sources.sql"), "utf8");
    const sourceIds = [...sql.matchAll(/'(p\d-[^']+|audit-row-\d+)'/g)].map((match) => match[1]);

    expect(sourceIds).toEqual([
      "p2-0076-ameriprise-financial",
      "audit-row-536",
      "p2-0103-fbi",
      "p4-0268-fbi-los-angeles-field-office",
      "p5-0722-saic",
      "p5-0728-siemens-healthineers",
      "p5-1039-revolut",
    ]);
    expect(sql).toContain("SET `next_crawl_at` = CURRENT_TIMESTAMP");
  });

  it("persists the verified Wayfair job catalog URL", () => {
    const sql = readFileSync(resolve(drizzlePath, "0103_refresh_sources_20260815143518.sql"), "utf8");

    expect(sql).toContain("'p5-1104-wayfair'");
    expect(sql).toContain("'https://www.wayfair.com/careers/jobs'");
    expect(sql).toContain("'https://www.wayfair.com/careers'");
    expect(sql).not.toContain("'https://www.aboutwayfair.com/careers'");
  });

  it("persists only the verified Community Health Systems jobs URL in its catalog refresh", () => {
    const sql = readFileSync(resolve(drizzlePath, "0108_refresh_sources_20260815231906.sql"), "utf8");

    expect(sql).toContain("'legacy-row-84'");
    expect(sql).toContain("'https://www.careershealthcare.com/job/'");
    expect(sql).not.toContain("'p2-0089-cincinnati-financial'");
    expect(sql).not.toContain("'legacy-row-836'");
  });
});
