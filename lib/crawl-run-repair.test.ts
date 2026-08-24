import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { finalizeStaleCrawlRuns } from "./crawl-run-repair";

const createD1 = (sqlite: DatabaseSync): D1Database => ({
  prepare(sql: string) {
    const statement = sqlite.prepare(sql);
    const bind = (...values: unknown[]) => ({
      all: async <T>() => ({ results: statement.all(...values as never[]) as T[] }),
      run: async () => statement.run(...values as never[]),
    });
    return {
      all: async <T>() => ({ results: statement.all() as T[] }),
      run: async () => statement.run(),
      bind,
    };
  },
}) as unknown as D1Database;

const database = (): DatabaseSync => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE sources (
      id TEXT PRIMARY KEY,
      next_crawl_at TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE crawl_runs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      error TEXT
    );
    INSERT INTO sources (id, next_crawl_at) VALUES
      ('stale-source', '2026-08-24T12:00:00.000Z'),
      ('fresh-source', '2026-08-24T12:00:00.000Z'),
      ('done-source', '2026-08-24T12:00:00.000Z');
    INSERT INTO crawl_runs (id, source_id, status, started_at, finished_at, error) VALUES
      ('stale-run', 'stale-source', 'running', '2026-08-24T11:00:00.000Z', NULL, NULL),
      ('fresh-run', 'fresh-source', 'running', '2026-08-24T11:04:30.000Z', NULL, NULL),
      ('done-run', 'done-source', 'succeeded', '2026-08-24T10:00:00.000Z', '2026-08-24T10:01:00.000Z', NULL);
  `);
  return sqlite;
};

describe("stale crawl run repair", () => {
  it("finalizes only stale running rows and releases their source lease", async () => {
    const sqlite = database();
    const result = await finalizeStaleCrawlRuns(createD1(sqlite), "2026-08-24T11:05:00.000Z", 120);

    expect(result).toEqual({
      cutoff: "2026-08-24T11:03:00.000Z",
      finalized: 1,
      releasedSources: 1,
      runIds: ["stale-run"],
    });
    expect(sqlite.prepare("SELECT status, finished_at, error FROM crawl_runs WHERE id = 'stale-run'").get())
      .toEqual({
        status: "failed",
        finished_at: "2026-08-24T11:05:00.000Z",
        error: "Timed out after the crawler client disconnected.",
      });
    expect(sqlite.prepare("SELECT status, finished_at FROM crawl_runs WHERE id = 'fresh-run'").get())
      .toEqual({ status: "running", finished_at: null });
    expect(sqlite.prepare("SELECT next_crawl_at FROM sources WHERE id = 'stale-source'").get())
      .toEqual({ next_crawl_at: "2026-08-24T11:05:00.000Z" });
    expect(sqlite.prepare("SELECT next_crawl_at FROM sources WHERE id = 'fresh-source'").get())
      .toEqual({ next_crawl_at: "2026-08-24T12:00:00.000Z" });
  });

  it("is a no-op when no running row is stale", async () => {
    const sqlite = database();
    const result = await finalizeStaleCrawlRuns(createD1(sqlite), "2026-08-24T11:01:00.000Z", 120);

    expect(result).toEqual({
      cutoff: "2026-08-24T10:59:00.000Z",
      finalized: 0,
      releasedSources: 0,
      runIds: [],
    });
  });
});
