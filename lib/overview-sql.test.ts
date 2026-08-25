import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { overviewActivitySql, overviewCountsSql } from "./overview-sql";

describe("overview counts SQL", () => {
  it("excludes disabled sources from the source error count", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE sources (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, posting_url TEXT);
      CREATE TABLE crawl_runs (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, status TEXT NOT NULL, scheduled_for TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, jobs_seen INTEGER DEFAULT 0, jobs_created INTEGER DEFAULT 0, jobs_updated INTEGER DEFAULT 0, jobs_closed INTEGER DEFAULT 0, error TEXT);
      CREATE TABLE jobs (status TEXT NOT NULL);
      CREATE TABLE keywords (enabled INTEGER NOT NULL);
      INSERT INTO sources VALUES
        ('active-blocked', 1, 'https://example.com/jobs'),
        ('inactive-blocked', 0, NULL),
        ('active-healthy', 1, 'https://example.org/jobs');
      INSERT INTO crawl_runs (id, source_id, status, scheduled_for, started_at, finished_at) VALUES
        ('run-1', 'active-blocked', 'blocked', '2026-08-10 01:00:00', '2026-08-10 01:00:00', '2026-08-10 01:01:00'),
        ('run-2', 'inactive-blocked', 'blocked', '2026-08-10 01:00:00', '2026-08-10 01:00:00', '2026-08-10 01:01:00'),
        ('run-3', 'active-healthy', 'succeeded', '2026-08-10 01:00:00', '2026-08-10 01:00:00', '2026-08-10 01:01:00');
    `);

    expect(sqlite.prepare(overviewCountsSql).get()).toMatchObject({
      active_sources: 2,
      source_errors: 1,
    });
  });

  it("reads overview activity in insertion order without sorting the crawl history", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE sources (id TEXT PRIMARY KEY, company TEXT NOT NULL);
      CREATE TABLE crawl_runs (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT, finished_at TEXT, jobs_seen INTEGER DEFAULT 0, jobs_created INTEGER DEFAULT 0, jobs_updated INTEGER DEFAULT 0, jobs_closed INTEGER DEFAULT 0, error TEXT);
      INSERT INTO sources VALUES ('source-1', 'One'), ('source-2', 'Two');
      INSERT INTO crawl_runs (id, source_id, status, started_at) VALUES
        ('run-1', 'source-1', 'succeeded', '2026-08-10 02:00:00'),
        ('run-2', 'source-2', 'failed', '2026-08-10 01:00:00');
    `);

    const rows = sqlite.prepare(overviewActivitySql).all(1) as Array<{ id: string }>;
    expect(rows).toEqual([{ id: "run-2", company: "Two", status: "failed", started_at: "2026-08-10 01:00:00", finished_at: null, jobs_seen: 0, jobs_created: 0, jobs_updated: 0, jobs_closed: 0, error: null }]);
  });
});
