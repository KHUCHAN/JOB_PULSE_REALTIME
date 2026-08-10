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
        id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
        program_classified_at TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE job_programs (
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        program_key TEXT NOT NULL, evidence TEXT NOT NULL, classified_at TEXT NOT NULL,
        PRIMARY KEY (job_id, program_key)
      );
      INSERT INTO jobs VALUES
        ('a', '2027 Data Science Intern / Co-op', 'open', NULL, CURRENT_TIMESTAMP),
        ('b', '2027 Werkstudent Data Science', 'open', NULL, CURRENT_TIMESTAMP),
        ('c', '2027 Internal Audit Analyst', 'open', NULL, CURRENT_TIMESTAMP),
        ('d', '2027 Finance Intern', 'closed', NULL, CURRENT_TIMESTAMP),
        ('e', '2027 Product Internship', 'open', '2026-08-09', CURRENT_TIMESTAMP);
      INSERT INTO job_programs VALUES ('c', 'internship', 'stale', '2026-08-09');
    `);

    const db = createD1(sqlite);
    expect(await backfillJobPrograms(db, 3)).toEqual({ processed: 3, matchedJobs: 2, memberships: 3, remaining: 0 });
    expect(sqlite.prepare("SELECT job_id, program_key FROM job_programs ORDER BY job_id, program_key").all()).toEqual([
      { job_id: "a", program_key: "coop" },
      { job_id: "a", program_key: "internship" },
      { job_id: "b", program_key: "internship" },
    ]);
    expect(await backfillJobPrograms(db, 3)).toEqual({ processed: 0, matchedJobs: 0, memberships: 0, remaining: 0 });
  });
});
