import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { backfillJobAreasAndRegions } from "./job-area-region-backfill";

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

describe("backfillJobAreasAndRegions", () => {
  it("classifies pending open jobs and replaces only managed area topics", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
        summary TEXT, description TEXT, responsibilities TEXT, qualifications TEXT, skills TEXT,
        department TEXT, team TEXT, business_unit TEXT, job_family TEXT, job_function TEXT,
        location TEXT, location_city TEXT, location_state TEXT, location_country TEXT,
        secondary_locations TEXT, location_region TEXT, area_classified_at TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE job_topics (
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        topic_key TEXT NOT NULL, score INTEGER NOT NULL, evidence TEXT NOT NULL, classified_at TEXT NOT NULL,
        PRIMARY KEY (job_id, topic_key)
      );
      INSERT INTO jobs VALUES
        ('a', 'Summer 2027 Software Engineering Internship', 'open', NULL, NULL, NULL, NULL, '[]', NULL, NULL, NULL, NULL, NULL, 'Austin, TX', NULL, NULL, 'United States', '[]', NULL, NULL, CURRENT_TIMESTAMP),
        ('b', 'Intern, Information Technology 2027', 'open', NULL, 'Assignments include Artificial Intelligence and Data & Analytics.', NULL, NULL, '[]', NULL, NULL, NULL, NULL, NULL, 'Toronto, Ontario, Canada', NULL, NULL, 'Canada', '[]', NULL, NULL, CURRENT_TIMESTAMP),
        ('c', 'Leadership Development Program Intern', 'open', NULL, NULL, NULL, NULL, '[]', NULL, NULL, NULL, NULL, NULL, 'Remote', NULL, NULL, NULL, '[]', NULL, NULL, CURRENT_TIMESTAMP),
        ('d', 'Data Scientist Intern', 'closed', NULL, NULL, NULL, NULL, '[]', NULL, NULL, NULL, NULL, NULL, 'New York, NY', NULL, NULL, 'US', '[]', NULL, NULL, CURRENT_TIMESTAMP),
        ('e', 'Business Intern', 'open', NULL, NULL, NULL, NULL, '[]', NULL, NULL, NULL, NULL, NULL, 'Chicago, IL', NULL, NULL, NULL, '[]', NULL, 'v2:2026-08-10T00:00:00.000Z', CURRENT_TIMESTAMP),
        ('f', 'Human Resources Intern', 'open', NULL, 'Use AI tools for drafting. We embrace responsible artificial intelligence in recruiting.', NULL, NULL, '[]', NULL, NULL, NULL, NULL, NULL, 'Boston, MA', NULL, NULL, 'US', '[]', NULL, '2026-08-10', CURRENT_TIMESTAMP);
      INSERT INTO job_topics VALUES
        ('c', 'area:software-engineering', 99, '["stale"]', '2026-08-09'),
        ('c', 'program:internship', 1, '["keep"]', '2026-08-09'),
        ('e', 'area:data-analytics', 2, '["keep-existing"]', '2026-08-09');
    `);

    const db = createD1(sqlite);
    expect(await backfillJobAreasAndRegions(db, 500)).toEqual({
      processed: 5,
      areaMatched: 2,
      regionResolved: 4,
      remaining: 0,
    });
    expect(sqlite.prepare("SELECT id, location_region FROM jobs WHERE status = 'open' ORDER BY id").all()).toEqual([
      { id: "a", location_region: "us" },
      { id: "b", location_region: "non_us" },
      { id: "c", location_region: "unknown" },
      { id: "e", location_region: "us" },
      { id: "f", location_region: "us" },
    ]);
    expect(sqlite.prepare("SELECT job_id, topic_key FROM job_topics ORDER BY job_id, topic_key").all()).toEqual([
      { job_id: "a", topic_key: "area:software-engineering" },
      { job_id: "b", topic_key: "area:ai-ml" },
      { job_id: "b", topic_key: "area:data-analytics" },
      { job_id: "c", topic_key: "program:internship" },
      { job_id: "e", topic_key: "area:data-analytics" },
    ]);
    expect(sqlite.prepare("SELECT area_classified_at FROM jobs WHERE id = 'f'").get()).toEqual({
      area_classified_at: expect.stringMatching(/^v2:/),
    });
    expect(await backfillJobAreasAndRegions(db, 500)).toEqual({
      processed: 0,
      areaMatched: 0,
      regionResolved: 0,
      remaining: 0,
    });
  });
});
