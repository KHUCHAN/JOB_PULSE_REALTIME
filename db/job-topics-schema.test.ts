import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { jobTopics } from "./schema";

describe("job topic schema", () => {
  it("exposes the jobTopics Drizzle table", () => {
    expect(jobTopics).toBeDefined();
  });

  it("creates indexed topic memberships that cascade with jobs", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.exec("CREATE TABLE jobs (id TEXT PRIMARY KEY)");
    const migration = readFileSync(resolve(process.cwd(), "drizzle/0037_ai_data_job_topics.sql"), "utf8");
    sqlite.exec(migration);

    sqlite.prepare("INSERT INTO jobs (id) VALUES (?)").run("job-1");
    sqlite.prepare(`
      INSERT INTO job_topics (job_id, topic_key, score, evidence, classified_at)
      VALUES (?, ?, ?, ?, ?)
    `).run("job-1", "ai-data", 4, '["title:data engineering"]', "2026-08-10T00:00:00.000Z");

    const indexes = sqlite.prepare("SELECT name FROM pragma_index_list('job_topics')").all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toContain("job_topics_topic_job_idx");
    sqlite.prepare("DELETE FROM jobs WHERE id = ?").run("job-1");
    expect(sqlite.prepare("SELECT count(*) AS count FROM job_topics").get()).toEqual({ count: 0 });
  });
});
