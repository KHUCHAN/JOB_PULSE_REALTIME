import { describe, expect, it } from "vitest";
import { ensureCatalogSeeded, type CatalogSeed } from "./catalog-bootstrap";

const seed: CatalogSeed = {
  generatedAt: "2026-08-09",
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

function fakeDb(existing: number) {
  const writes: string[][] = [];
  return {
    writes,
    db: {
      prepare(sql: string) {
        void sql;
        return {
          bind(...values: unknown[]) {
            return {
              first: async () => ({ count: existing }),
              run: async () => {
                writes.push(JSON.parse(String(values[0])).map((row: { id: string }) => row.id));
                return { success: true };
              },
            };
          },
          first: async () => ({ count: existing }),
        };
      },
    },
  };
}

describe("runtime catalog bootstrap", () => {
  it("does not rewrite a catalog that is already present", async () => {
    const { db, writes } = fakeDb(1455);
    expect(await ensureCatalogSeeded(db, seed)).toEqual({ seeded: false, sources: 1455, talentTargets: 0 });
    expect(writes).toEqual([]);
  });

  it("inserts bounded source batches before dependent talent targets", async () => {
    const { db, writes } = fakeDb(0);
    expect(await ensureCatalogSeeded(db, seed)).toEqual({ seeded: true, sources: 501, talentTargets: 1 });
    expect(writes).toHaveLength(3);
    expect(writes[0]).toHaveLength(500);
    expect(writes[1]).toEqual(["source-500"]);
    expect(writes[2]).toEqual(["talent-1"]);
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
        job_alerts TEXT, enabled INTEGER, checked_at TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE talent_targets (
        id TEXT PRIMARY KEY, source_id TEXT, official_url TEXT, resume_upload TEXT,
        job_alerts TEXT, registration_state TEXT DEFAULT 'not_started', checked_at TEXT,
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
    sqlite.close();
  });
});
