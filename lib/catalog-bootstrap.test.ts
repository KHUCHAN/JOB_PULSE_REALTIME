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
        job_alerts TEXT, enabled INTEGER, checked_at TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE talent_targets (
        id TEXT PRIMARY KEY, source_id TEXT, official_url TEXT, resume_upload TEXT,
        job_alerts TEXT, registration_state TEXT DEFAULT 'not_started', checked_at TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE catalog_state (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
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
