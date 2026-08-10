import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { backfillJobTopics } from "./job-topic-backfill";

const createD1 = (sqlite: DatabaseSync): D1Database => ({
  prepare(sql: string) {
    const statement = sqlite.prepare(sql);
    return {
      first: async <T>() => statement.get() as T | null,
      bind(...values: unknown[]) {
        return {
          all: async <T>() => ({ results: statement.all(...values as never[]) as T[] }),
          first: async <T>() => statement.get(...values as never[]) as T | null,
          run: async () => statement.run(...values as never[]),
        };
      },
    };
  },
}) as unknown as D1Database;

describe("backfillJobTopics", () => {
  it("classifies only pending open jobs in bounded, idempotent batches", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT, description TEXT,
        responsibilities TEXT, qualifications TEXT, skills TEXT NOT NULL DEFAULT '[]',
        department TEXT, team TEXT, business_unit TEXT, job_family TEXT, job_function TEXT,
        status TEXT NOT NULL, topic_classified_at TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE job_topics (
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        topic_key TEXT NOT NULL, score INTEGER NOT NULL, evidence TEXT NOT NULL,
        classified_at TEXT NOT NULL, PRIMARY KEY (job_id, topic_key)
      );
    `);
    const insert = sqlite.prepare(`
      INSERT INTO jobs (id, title, description, skills, team, status, topic_classified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run("a-data", "Data Engineer", "Build reliable pipelines.", "[]", null, "open", null);
    insert.run("b-sales", "Account Executive", "Use AI tools for meeting notes.", "[]", null, "open", null);
    insert.run("c-ml", "Software Engineer", null, '["PyTorch"]', "Generative AI", "open", null);
    insert.run("d-done", "Machine Learning Engineer", null, "[]", null, "open", "2026-08-09T00:00:00.000Z");
    insert.run("e-closed", "Data Scientist", null, "[]", null, "closed", null);
    sqlite.prepare(`
      INSERT INTO job_topics (job_id, topic_key, score, evidence, classified_at)
      VALUES ('b-sales', 'ai-data', 99, '["stale"]', '2026-08-09T00:00:00.000Z')
    `).run();

    const db = createD1(sqlite);
    expect(await backfillJobTopics(db, 2)).toEqual({ processed: 2, matched: 1, remaining: 1 });
    expect(sqlite.prepare("SELECT job_id FROM job_topics ORDER BY job_id").all()).toEqual([{ job_id: "a-data" }]);
    expect(sqlite.prepare("SELECT count(*) AS count FROM jobs WHERE status = 'open' AND topic_classified_at IS NULL").get())
      .toEqual({ count: 1 });

    expect(await backfillJobTopics(db, 2)).toEqual({ processed: 1, matched: 1, remaining: 0 });
    expect(await backfillJobTopics(db, 2)).toEqual({ processed: 0, matched: 0, remaining: 0 });
    expect(sqlite.prepare("SELECT job_id, topic_key FROM job_topics ORDER BY job_id").all()).toEqual([
      { job_id: "a-data", topic_key: "ai-data" },
      { job_id: "c-ml", topic_key: "ai-data" },
    ]);
    expect(sqlite.prepare("SELECT topic_classified_at FROM jobs WHERE id = 'd-done'").get())
      .toEqual({ topic_classified_at: "2026-08-09T00:00:00.000Z" });
    expect(sqlite.prepare("SELECT topic_classified_at FROM jobs WHERE id = 'e-closed'").get())
      .toEqual({ topic_classified_at: null });
  });
});
