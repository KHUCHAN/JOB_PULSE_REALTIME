import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { backfillJobPrograms } from "./job-program-backfill";

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

describe("backfillJobPrograms", () => {
  it("classifies pending open jobs idempotently with multilingual and co-op memberships", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, employment_type TEXT,
        program_classified_at TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE job_programs (
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        program_key TEXT NOT NULL, evidence TEXT NOT NULL, classified_at TEXT NOT NULL,
        PRIMARY KEY (job_id, program_key)
      );
      CREATE TABLE catalog_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
      INSERT INTO jobs VALUES
        ('a', '2027 Data Science Intern / Co-op', 'open', 'INTERN', NULL, CURRENT_TIMESTAMP),
        ('b', '2027 Werkstudent Data Science', 'open', '["Part time","Part time"]', NULL, CURRENT_TIMESTAMP),
        ('c', '2027 Internal Audit Analyst', 'open', 'R244285', NULL, CURRENT_TIMESTAMP),
        ('d', '2027 Finance Intern', 'closed', 'INTERN', NULL, CURRENT_TIMESTAMP),
        ('e', '2027 Product Internship', 'open', 'Full-Time', '2026-08-09', CURRENT_TIMESTAMP);
      INSERT INTO job_programs VALUES ('c', 'internship', 'stale', '2026-08-09');
    `);

    const db = createD1(sqlite);
    expect(await backfillJobPrograms(db, 2)).toEqual({ processed: 2, matchedJobs: 2, memberships: 3, remaining: 1 });
    expect(await backfillJobPrograms(db, 2)).toEqual({ processed: 1, matchedJobs: 0, memberships: 0, remaining: 0 });
    expect(sqlite.prepare("SELECT job_id, program_key FROM job_programs ORDER BY job_id, program_key").all()).toEqual([
      { job_id: "a", program_key: "coop" },
      { job_id: "a", program_key: "internship" },
      { job_id: "b", program_key: "internship" },
    ]);
    expect(sqlite.prepare("SELECT id, employment_type FROM jobs WHERE id IN ('a','b','c') ORDER BY id").all()).toEqual([
      { id: "a", employment_type: "Internship" },
      { id: "b", employment_type: "Part-time" },
      { id: "c", employment_type: null },
    ]);
    expect(await backfillJobPrograms(db, 2)).toEqual({ processed: 0, matchedJobs: 0, memberships: 0, remaining: 0 });
    expect(sqlite.prepare("SELECT value FROM catalog_state WHERE key = 'job_program_backfill_cursor'").get())
      .toEqual({ value: "c" });
  });
});
