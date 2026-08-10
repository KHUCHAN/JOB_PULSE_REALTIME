import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { overviewCountsSql } from "./overview-sql";

describe("overview counts SQL", () => {
  it("excludes disabled sources from the source error count", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE sources (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, posting_url TEXT);
      CREATE TABLE crawl_runs (source_id TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT);
      CREATE TABLE jobs (status TEXT NOT NULL);
      CREATE TABLE keywords (enabled INTEGER NOT NULL);
      INSERT INTO sources VALUES
        ('active-blocked', 1, 'https://example.com/jobs'),
        ('inactive-blocked', 0, NULL),
        ('active-healthy', 1, 'https://example.org/jobs');
      INSERT INTO crawl_runs VALUES
        ('active-blocked', 'blocked', '2026-08-10 01:00:00', '2026-08-10 01:01:00'),
        ('inactive-blocked', 'blocked', '2026-08-10 01:00:00', '2026-08-10 01:01:00'),
        ('active-healthy', 'succeeded', '2026-08-10 01:00:00', '2026-08-10 01:01:00');
    `);

    expect(sqlite.prepare(overviewCountsSql).get()).toMatchObject({
      active_sources: 2,
      source_errors: 1,
    });
  });
});
