import { describe, expect, it } from "vitest";
import { ensureCatalogSeeded, type CatalogSeed } from "./catalog-bootstrap";

const seed: CatalogSeed = {
  generatedAt: "2026-08-09",
  version: "catalog-v1",
  sources: Array.from({ length: 501 }, (_, index) => ({
    id: `source-${index}`, masterRow: index + 1, company: `Company ${index}`,
    postingUrl: `https://example.com/${index}`, talentUrl: null, channel: "careers",
    adapter: "custom", verification: "career_only", confidence: "high",
    resumeUpload: "job_only", jobAlerts: "unknown", checkedAt: "2026-08-09", enabled: true,
  })),
  talentTargets: [{
    id: "talent-1", sourceId: "source-0", officialUrl: "https://example.com/talent",
    resumeUpload: "available", jobAlerts: "available", checkedAt: "2026-08-09",
  }],
};

function fakeDb(existing: number, version: string | null = null) {
  const writes: Array<{ kind: "sources" | "talent" | "state"; values: string[] }> = [];
  return {
    writes,
    db: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              first: async () => ({ count: existing, version }),
              run: async () => {
                if (sql.includes("INSERT INTO sources")) {
                  writes.push({ kind: "sources", values: JSON.parse(String(values[0])).map((row: { id: string }) => row.id) });
                } else if (sql.includes("INSERT INTO talent_targets")) {
                  writes.push({ kind: "talent", values: JSON.parse(String(values[0])).map((row: { id: string }) => row.id) });
                } else if (sql.includes("INSERT INTO catalog_state")) {
                  writes.push({ kind: "state", values: values.map(String) });
                }
                return { success: true };
              },
            };
          },
          first: async () => ({ count: existing, version }),
        };
      },
    },
  };
}

describe("runtime catalog bootstrap", () => {
  it("does not rewrite a catalog whose version is already current", async () => {
    const { db, writes } = fakeDb(1455, seed.version);
    expect(await ensureCatalogSeeded(db, seed)).toEqual({ seeded: false, sources: 1455, talentTargets: 0 });
    expect(writes).toEqual([]);
  });

  it("refreshes an existing catalog when the bundled version changes and records the marker last", async () => {
    const { db, writes } = fakeDb(1455, "catalog-v0");

    expect(await ensureCatalogSeeded(db, seed)).toEqual({ seeded: true, sources: 501, talentTargets: 1 });
    expect(writes.at(-1)).toEqual({ kind: "state", values: ["sources", seed.version] });
    expect(writes.filter((write) => write.kind === "sources")).toHaveLength(2);
    expect(writes.filter((write) => write.kind === "talent")).toHaveLength(1);
  });

  it("inserts bounded source batches before dependent talent targets", async () => {
    const { db, writes } = fakeDb(0);
    expect(await ensureCatalogSeeded(db, seed)).toEqual({ seeded: true, sources: 501, talentTargets: 1 });
    expect(writes).toHaveLength(4);
    expect(writes[0]).toEqual({ kind: "sources", values: expect.arrayContaining(["source-0", "source-499"]) });
    expect(writes[0].values).toHaveLength(500);
    expect(writes[1]).toEqual({ kind: "sources", values: ["source-500"] });
    expect(writes[2]).toEqual({ kind: "talent", values: ["talent-1"] });
    expect(writes[3]).toEqual({ kind: "state", values: ["sources", seed.version] });
  });

  it("executes the bootstrap statements against SQLite", async () => {
    const emitWarning = process.emitWarning;
    process.emitWarning = (() => undefined) as typeof process.emitWarning;
    const { DatabaseSync } = await import("node:sqlite");
    process.emitWarning = emitWarning;
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE sources (
        id TEXT PRIMARY KEY, master_row INTEGER, company TEXT, posting_url TEXT, talent_url TEXT,
        channel TEXT, adapter TEXT, verification TEXT, confidence TEXT, resume_upload TEXT,
        job_alerts TEXT, enabled INTEGER, checked_at TEXT, next_crawl_at TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE talent_targets (
        id TEXT PRIMARY KEY, source_id TEXT, official_url TEXT, resume_upload TEXT,
        job_alerts TEXT, registration_state TEXT DEFAULT 'not_started', checked_at TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE catalog_state (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, status TEXT NOT NULL,
        location_region TEXT, published_at TEXT, source_updated_at TEXT,
        closed_at TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE job_matches (
        job_id TEXT PRIMARY KEY, is_active INTEGER NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const database = {
      prepare(sql: string) {
        const statement = sqlite.prepare(sql);
        return {
          first: async () => statement.get(),
          bind(...values: unknown[]) {
            return {
              first: async () => statement.get(...values as never[]),
              run: async () => statement.run(...values as never[]),
            };
          },
        };
      },
    };

    await ensureCatalogSeeded(database, { ...seed, sources: seed.sources.slice(0, 1) });

    expect(sqlite.prepare("SELECT count(*) AS count FROM sources").get()).toEqual({ count: 1 });
    expect(sqlite.prepare("SELECT count(*) AS count FROM talent_targets").get()).toEqual({ count: 1 });

    sqlite.prepare("UPDATE sources SET next_crawl_at = '2099-01-01 00:00:00' WHERE id = ?").run(seed.sources[0].id);
    sqlite.prepare("INSERT INTO jobs (id, source_id, status, location_region) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)").run(
      "non-us", seed.sources[0].id, "open", "non_us",
      "unknown", seed.sources[0].id, "open", "unknown",
      "other-source", seed.sources[1].id, "open", "non_us",
    );
    sqlite.prepare("UPDATE jobs SET published_at = '2099-01-01T00:00:00.000Z', source_updated_at = '2099-01-02T00:00:00.000Z' WHERE id = 'unknown'").run();
    sqlite.prepare("INSERT INTO catalog_state (key, value) VALUES (?, ?), (?, ?)").run(
      `crawl_page_checkpoint:${seed.sources[0].id}`, JSON.stringify({ nextPage: 9 }),
      `crawl_page_checkpoint:${seed.sources[1].id}`, JSON.stringify({ nextPage: 7 }),
    );
    await ensureCatalogSeeded(database, {
      ...seed,
      version: "catalog-v2",
      sources: [{ ...seed.sources[0], postingUrl: "https://example.com/updated" }],
    });
    expect(sqlite.prepare("SELECT posting_url AS postingUrl, next_crawl_at AS nextCrawlAt FROM sources").get())
      .toMatchObject({ postingUrl: "https://example.com/updated", nextCrawlAt: expect.not.stringContaining("2099") });
    expect(sqlite.prepare("SELECT value FROM catalog_state WHERE key = ?").get(
      `crawl_page_checkpoint:${seed.sources[0].id}`,
    )).toBeUndefined();
    expect(sqlite.prepare("SELECT value FROM catalog_state WHERE key = ?").get(
      `crawl_page_checkpoint:${seed.sources[1].id}`,
    )).toEqual({ value: JSON.stringify({ nextPage: 7 }) });
    expect(sqlite.prepare("SELECT published_at, source_updated_at FROM jobs WHERE id = 'unknown'").get())
      .toEqual({ published_at: null, source_updated_at: null });

    sqlite.prepare("UPDATE sources SET next_crawl_at = '2099-01-01 00:00:00' WHERE id = ?").run(seed.sources[0].id);
    sqlite.prepare("INSERT INTO catalog_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
      `crawl_page_checkpoint:${seed.sources[0].id}`, JSON.stringify({ nextPage: 19 }),
    );
    expect(await ensureCatalogSeeded(database, {
      ...seed,
      version: "catalog-v2",
      sources: [{ ...seed.sources[0], postingUrl: "https://example.com/updated" }],
    }, {
      version: "large-us-test-v1",
      sourceIds: [seed.sources[0].id],
    })).toEqual({ seeded: false, sources: 1, talentTargets: 0 });
    expect(sqlite.prepare("SELECT value FROM catalog_state WHERE key = ?").get(
      `crawl_page_checkpoint:${seed.sources[0].id}`,
    )).toBeUndefined();
    expect(sqlite.prepare("SELECT next_crawl_at < '2099' AS due FROM sources WHERE id = ?").get(seed.sources[0].id))
      .toEqual({ due: 1 });
    expect(sqlite.prepare("SELECT value FROM catalog_state WHERE key = 'crawler_scope_policy'").get())
      .toEqual({ value: "large-us-test-v1" });
    expect(sqlite.prepare("SELECT id, status, closed_at AS closedAt FROM jobs ORDER BY id").all()).toEqual([
      { id: "non-us", status: "closed", closedAt: expect.any(String) },
      { id: "other-source", status: "open", closedAt: null },
      { id: "unknown", status: "open", closedAt: null },
    ]);

    // Re-running the same policy is a no-op, so rows are not repeatedly
    // rewritten and a later non-US row remains open until the next version.
    sqlite.prepare("INSERT INTO jobs (id, source_id, status, location_region) VALUES (?, ?, ?, ?)").run(
      "later-non-us", seed.sources[0].id, "open", "non_us",
    );
    await ensureCatalogSeeded(database, {
      ...seed,
      version: "catalog-v2",
      sources: [{ ...seed.sources[0], postingUrl: "https://example.com/updated" }],
    }, {
      version: "large-us-test-v1",
      sourceIds: [seed.sources[0].id],
    });
    expect(sqlite.prepare("SELECT status FROM jobs WHERE id = 'later-non-us'").get()).toEqual({ status: "open" });

    sqlite.prepare("UPDATE sources SET next_crawl_at = '2099-01-01 00:00:00' WHERE id = ?").run(seed.sources[0].id);
    sqlite.prepare("INSERT INTO jobs (id, source_id, status, location_region) VALUES (?, ?, ?, ?)").run(
      "retired-job", seed.sources[0].id, "open", "unknown",
    );
    sqlite.prepare("INSERT INTO job_matches (job_id, is_active) VALUES (?, ?)").run("retired-job", 1);
    sqlite.prepare("INSERT INTO catalog_state (key, value) VALUES (?, ?)").run(
      `crawl_page_checkpoint:${seed.sources[0].id}`, JSON.stringify({ nextPage: 27 }),
    );
    await ensureCatalogSeeded(database, {
      ...seed,
      version: "catalog-v3",
      sources: [{ ...seed.sources[0], postingUrl: null, talentUrl: null, enabled: false }],
      talentTargets: [],
    });
    expect(sqlite.prepare("SELECT enabled, next_crawl_at AS nextCrawlAt FROM sources WHERE id = ?").get(seed.sources[0].id))
      .toEqual({ enabled: 0, nextCrawlAt: null });
    expect(sqlite.prepare("SELECT value FROM catalog_state WHERE key = ?").get(
      `crawl_page_checkpoint:${seed.sources[0].id}`,
    )).toBeUndefined();
    expect(sqlite.prepare("SELECT count(*) AS count FROM talent_targets WHERE source_id = ?").get(seed.sources[0].id))
      .toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT status, closed_at IS NOT NULL AS closed FROM jobs WHERE id = 'retired-job'").get())
      .toEqual({ status: "closed", closed: 1 });
    expect(sqlite.prepare("SELECT is_active AS active FROM job_matches WHERE job_id = 'retired-job'").get())
      .toEqual({ active: 0 });
    sqlite.close();
  });
});
