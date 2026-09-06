import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { D1CrawlStore } from "./crawl-store";

describe("batched crawl lifecycle", () => {
  it("uses two ordered atomic round trips and preserves unrelated runs", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`CREATE TABLE sources(id TEXT PRIMARY KEY, last_crawled_at TEXT, next_crawl_at TEXT, updated_at TEXT);
      CREATE TABLE crawl_runs(id TEXT PRIMARY KEY, source_id TEXT, scheduled_for TEXT, started_at TEXT,
      status TEXT, response_status INTEGER, jobs_seen INTEGER, jobs_created INTEGER, jobs_updated INTEGER,
      jobs_closed INTEGER, error TEXT, finished_at TEXT);
      INSERT INTO sources(id) VALUES ('a');
      INSERT INTO crawl_runs(id,source_id,status) VALUES ('old','a','running'), ('other','b','running');`);
    let trips = 0;
    let failSecond = false;
    const db = {
      prepare(sql: string) {
        return { bind(...values: SQLInputValue[]) {
          return { run: () => sqlite.prepare(sql).run(...values) };
        } };
      },
      async batch(statements: Array<{run: () => unknown}>) {
        trips++;
        sqlite.exec("BEGIN");
        try {
          const results = statements.map((statement, index) => {
            if (failSecond && index === 1) throw new Error("injected scheduling failure");
            return statement.run();
          });
          sqlite.exec("COMMIT");
          return results;
        } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      },
    } as unknown as D1Database;
    try {
      const store = new D1CrawlStore(db);
      const id = await store.startRun({id: "a", company: "Acme", postingUrl: "https://example.com/jobs", adapter: "custom", nextCrawlAt: null}, "2026-09-06T16:00:00Z");
      expect(trips).toBe(1);
      expect(sqlite.prepare("SELECT status FROM crawl_runs WHERE id='old'").get()!.status).toBe("failed");
      expect(sqlite.prepare("SELECT status FROM crawl_runs WHERE id='other'").get()!.status).toBe("running");
      const terminal = {status: "succeeded", responseStatus: 200, jobsSeen: 10, jobsCreated: 2, jobsUpdated: 8, jobsClosed: 0, error: null, finishedAt: "2026-09-06T16:01:00Z"};
      failSecond = true;
      await expect(store.finishRunAndSchedule(id, terminal, "a", "2026-09-06T18:00:00Z")).rejects.toThrow("injected");
      expect(sqlite.prepare("SELECT status FROM crawl_runs WHERE id=?").get(id)!.status).toBe("running");
      expect(sqlite.prepare("SELECT next_crawl_at FROM sources WHERE id='a'").get()!.next_crawl_at).toBeNull();
      failSecond = false;
      trips--; // Exclude the deliberate failed transaction from the happy-path budget.
      await store.finishRunAndSchedule(id, terminal, "a", "2026-09-06T18:00:00Z");
      expect(trips).toBe(2);
      expect(sqlite.prepare("SELECT status,jobs_seen FROM crawl_runs WHERE id=?").get(id)).toEqual({status: "succeeded", jobs_seen: 10});
      expect(sqlite.prepare("SELECT next_crawl_at FROM sources WHERE id='a'").get()!.next_crawl_at).toBe("2026-09-06T18:00:00Z");
    } finally { sqlite.close(); }
  });
});
