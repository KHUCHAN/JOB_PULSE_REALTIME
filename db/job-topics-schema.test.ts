import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { jobPrograms, jobTopics } from "./schema";

describe("job topic schema", () => {
  it("exposes the jobTopics Drizzle table", () => {
    expect(jobTopics).toBeDefined();
  });

  it("creates indexed topic memberships that cascade with jobs", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.exec("CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT)");
    const migration = readFileSync(resolve(process.cwd(), "drizzle/0037_ai_data_job_topics.sql"), "utf8");
    sqlite.exec(migration);
    sqlite.exec(readFileSync(resolve(process.cwd(), "drizzle/0038_job_topic_backfill_index.sql"), "utf8"));

    sqlite.prepare("INSERT INTO jobs (id) VALUES (?)").run("job-1");
    sqlite.prepare(`
      INSERT INTO job_topics (job_id, topic_key, score, evidence, classified_at)
      VALUES (?, ?, ?, ?, ?)
    `).run("job-1", "ai-data", 4, '["title:data engineering"]', "2026-08-10T00:00:00.000Z");

    const indexes = sqlite.prepare("SELECT name FROM pragma_index_list('job_topics')").all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toContain("job_topics_topic_job_idx");
    const jobIndexes = sqlite.prepare("SELECT name FROM pragma_index_list('jobs')").all() as Array<{ name: string }>;
    expect(jobIndexes.map((index) => index.name)).toContain("jobs_status_topic_classified_id_idx");
    sqlite.prepare("DELETE FROM jobs WHERE id = ?").run("job-1");
    expect(sqlite.prepare("SELECT count(*) AS count FROM job_topics").get()).toEqual({ count: 0 });
  });

  it("exposes indexed job program memberships", () => {
    expect(jobPrograms).toBeDefined();

    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.exec("CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT, employment_type TEXT, updated_at TEXT)");
    sqlite.exec(readFileSync(resolve(process.cwd(), "drizzle/0040_indexed_job_programs.sql"), "utf8"));
    sqlite.prepare("INSERT INTO jobs (id, status) VALUES ('job-1', 'open')").run();
    sqlite.prepare("INSERT INTO job_programs VALUES (?, ?, ?, ?)")
      .run("job-1", "internship", "title:intern", "2026-08-10");

    const indexes = sqlite.prepare("SELECT name FROM pragma_index_list('job_programs')").all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toEqual(expect.arrayContaining([
      "job_programs_program_job_idx", "job_programs_job_program_idx",
    ]));
    sqlite.prepare("DELETE FROM jobs WHERE id = 'job-1'").run();
    expect(sqlite.prepare("SELECT count(*) AS count FROM job_programs").get()).toEqual({ count: 0 });
  });
});
