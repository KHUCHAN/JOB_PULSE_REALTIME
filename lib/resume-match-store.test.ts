import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  backfillResumeMatches,
  syncResumeMatches,
  syncResumeMatchesForUrls,
  type ResumeMatchCandidate,
} from "./resume-match-store";

const createD1 = (sqlite: DatabaseSync): D1Database => ({
  prepare(sql: string) {
    const statement = sqlite.prepare(sql);
    const bound = (values: unknown[]) => ({
      all: async <T>() => ({ results: statement.all(...values as never[]) as T[] }),
      first: async <T>() => statement.get(...values as never[]) as T | null,
      run: async () => statement.run(...values as never[]),
    });
    return {
      all: async <T>() => ({ results: statement.all() as T[] }),
      first: async <T>() => statement.get() as T | null,
      run: async () => statement.run(),
      bind: (...values: unknown[]) => bound(values),
    };
  },
}) as unknown as D1Database;

const migratedSqlite = (): DatabaseSync => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE sources (id text PRIMARY KEY);
    CREATE TABLE keywords (
      id text PRIMARY KEY,
      name text NOT NULL,
      include_terms text NOT NULL,
      exclude_terms text NOT NULL,
      locations text NOT NULL,
      enabled integer NOT NULL DEFAULT 1,
      delivery_mode text NOT NULL DEFAULT 'six_hour',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE jobs (
      id text PRIMARY KEY,
      source_id text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      title text NOT NULL,
      company text NOT NULL,
      location_region text,
      summary text,
      description text,
      responsibilities text,
      qualifications text,
      skills text NOT NULL DEFAULT '[]',
      job_family text,
      job_function text,
      education_requirements text,
      experience_requirements text,
      security_clearance text,
      published_at text,
      official_url text NOT NULL,
      status text NOT NULL DEFAULT 'open',
      first_seen_at text NOT NULL,
      last_seen_at text NOT NULL,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_id, official_url)
    );
    CREATE TABLE job_topics (
      job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      topic_key text NOT NULL,
      score integer NOT NULL DEFAULT 1,
      evidence text NOT NULL DEFAULT '[]',
      classified_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(job_id, topic_key)
    );
    CREATE TABLE job_matches (
      id text PRIMARY KEY,
      job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      keyword_id text NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      score integer NOT NULL,
      matched_terms text NOT NULL,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notified_at text
    );
    CREATE UNIQUE INDEX job_matches_job_keyword_unique ON job_matches(job_id, keyword_id);
    CREATE INDEX job_matches_keyword_created_idx ON job_matches(keyword_id, created_at);
    CREATE TABLE notifications (
      id text PRIMARY KEY,
      keyword_id text REFERENCES keywords(id) ON DELETE SET NULL,
      channel text NOT NULL,
      recipient text NOT NULL,
      status text NOT NULL,
      job_count integer NOT NULL DEFAULT 0,
      provider_message_id text,
      scheduled_at text NOT NULL,
      sent_at text,
      error text,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX notifications_status_scheduled_idx ON notifications(status, scheduled_at);
  `);
  sqlite.exec(readFileSync(resolve(process.cwd(), "drizzle/0046_resume_match_gmail_alerts.sql"), "utf8"));
  sqlite.exec(readFileSync(resolve(process.cwd(), "drizzle/0047_resume_alert_correctness.sql"), "utf8"));
  sqlite.exec(readFileSync(resolve(process.cwd(), "drizzle/0078_codex_reviews.sql"), "utf8"));
  return sqlite;
};

describe("resume match persistence migration", () => {
  it("supports a baseline resume match and recipient-specific delivery reservation", () => {
    const sqlite = migratedSqlite();
    const columns = sqlite.prepare("PRAGMA table_info(job_matches)").all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "open_generation",
      "is_active",
      "notification_eligible",
    ]));
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'codex_reviews'").get())
      .toEqual({ name: "codex_reviews" });
    expect(sqlite.prepare("SELECT recipient FROM profile_recipients ORDER BY recipient").all()).toEqual([
      { recipient: "kimchany@usc.edu" },
      { recipient: "lupeter@usc.edu" },
    ]);
    expect(() => sqlite.prepare(
      "INSERT INTO profile_recipients (profile_id, recipient, enabled) VALUES (?, ?, 1)",
    ).run("chanyoung-resume", "kimchany@usc.edu")).toThrow();
  });

  it("keeps baseline matches visible but notification-ineligible", async () => {
    const sqlite = migratedSqlite();
    sqlite.exec(`
      INSERT INTO sources (id) VALUES ('source');
      UPDATE match_profiles SET activation_watermark = '2026-08-10T12:00:00.000Z';
      INSERT INTO jobs (
        id, source_id, title, company, location_region, skills, official_url, status, first_seen_at, last_seen_at
      ) VALUES (
        'old', 'source', 'Data Science Intern', 'Acme', 'us', '["Python","SQL"]', 'https://example.com/old', 'open',
        '2026-08-10T11:00:00.000Z', '2026-08-10T11:00:00.000Z'
      );
      INSERT INTO job_topics (job_id, topic_key) VALUES
        ('old', 'program:internship'), ('old', 'year:2027');
    `);

    await backfillResumeMatches(createD1(sqlite), { afterId: null, limit: 100 });

    expect(sqlite.prepare(
      "SELECT is_active, notification_eligible FROM job_matches WHERE job_id = 'old'",
    ).get()).toEqual({ is_active: 1, notification_eligible: 0 });
  });

  it("keeps a post-watermark new match pending until Codex approves it", async () => {
    const sqlite = migratedSqlite();
    sqlite.exec(`
      INSERT INTO sources (id) VALUES ('source');
      UPDATE match_profiles SET enabled = 1, activation_watermark = '2026-08-10T12:00:00.000Z';
      INSERT INTO jobs (
        id, source_id, title, company, location_region, official_url, status, first_seen_at, last_seen_at
      ) VALUES (
        'new', 'source', 'Machine Learning Intern', 'Acme', 'us', 'https://example.com/new', 'open',
        '2026-08-10T12:01:00.000Z', '2026-08-10T12:01:00.000Z'
      );
    `);
    const candidate: ResumeMatchCandidate = {
      id: "new", title: "Machine Learning Intern", company: "Acme", locationRegion: "us",
      programKeys: ["internship"], summary: null, description: null, responsibilities: null,
      qualifications: null, skills: ["Python", "SQL"], jobFamily: null, jobFunction: null,
      educationRequirements: null, experienceRequirements: null, securityClearance: null,
      recruitingYears: [2027], publishedAt: null, firstSeenAt: "2026-08-10T12:01:00.000Z",
      reopenedAt: null, openGeneration: 1,
    };

    await syncResumeMatches(createD1(sqlite), [candidate], "2026-08-10T12:01:00.000Z");
    await syncResumeMatches(createD1(sqlite), [candidate], "2026-08-10T12:02:00.000Z");

    expect(sqlite.prepare("SELECT count(*) AS total FROM job_matches WHERE job_id = 'new'").get()).toEqual({ total: 1 });
    expect(sqlite.prepare(
      "SELECT notification_eligible FROM job_matches WHERE job_id = 'new'",
    ).get()).toEqual({ notification_eligible: 0 });
  });

  it("keeps a newly seen co-op pending for Codex review", async () => {
    const sqlite = migratedSqlite();
    sqlite.exec(`
      INSERT INTO sources (id) VALUES ('source');
      UPDATE match_profiles SET enabled = 1, activation_watermark = '2026-08-10T12:00:00.000Z';
      INSERT INTO jobs (
        id, source_id, title, company, location_region,
        official_url, status, first_seen_at, last_seen_at
      ) VALUES (
        'coop-new', 'source', 'Data Engineering Co-op 2027', 'Acme', 'us',
        'https://example.com/coop-new', 'open',
        '2026-08-10T12:01:00.000Z', '2026-08-10T12:01:00.000Z'
      );
      INSERT INTO job_topics (job_id, topic_key) VALUES
        ('coop-new', 'program:coop'), ('coop-new', 'year:2027');
    `);

    await syncResumeMatchesForUrls(
      createD1(sqlite), "source", ["https://example.com/coop-new"],
      "2026-08-10T12:02:00.000Z", ["https://example.com/coop-new"],
    );

    expect(sqlite.prepare(
      "SELECT is_active, notification_eligible, matched_terms FROM job_matches WHERE job_id = 'coop-new'",
    ).get()).toMatchObject({
      is_active: 1,
      notification_eligible: 0,
      matched_terms: expect.stringContaining("Server program gate: internship or co-op"),
    });
  });

  it("does not notify a post-watermark job unless the current crawl inserted it", async () => {
    const sqlite = migratedSqlite();
    sqlite.exec(`
      INSERT INTO sources (id) VALUES ('source');
      UPDATE match_profiles SET enabled = 1, activation_watermark = '2026-08-10T12:00:00.000Z';
      INSERT INTO jobs (
        id, source_id, title, company, location_region, skills, official_url, status, first_seen_at, last_seen_at
      ) VALUES
      (
        'updated', 'source', 'Machine Learning Intern', 'Acme', 'us', '["Python","SQL"]',
        'https://example.com/updated', 'open', '2026-08-10T12:01:00.000Z', '2026-08-10T13:00:00.000Z'
      ),
      (
        'inserted', 'source', 'Data Science Intern', 'Acme', 'us', '["Python","SQL"]',
        'https://example.com/inserted', 'open', '2026-08-10T12:02:00.000Z', '2026-08-10T13:00:00.000Z'
      );
      INSERT INTO job_topics (job_id, topic_key) VALUES
        ('updated', 'program:internship'), ('updated', 'year:2027'),
        ('inserted', 'program:internship'), ('inserted', 'year:2027');
    `);

    await syncResumeMatchesForUrls(
      createD1(sqlite),
      "source",
      ["https://example.com/updated", "https://example.com/inserted"],
      "2026-08-10T13:00:00.000Z",
      ["https://example.com/inserted"],
    );

    expect(sqlite.prepare(
      "SELECT job_id, is_active, notification_eligible FROM job_matches ORDER BY job_id",
    ).all()).toEqual([
      { job_id: "inserted", is_active: 1, notification_eligible: 0 },
      { job_id: "updated", is_active: 1, notification_eligible: 0 },
    ]);
  });

  it("does not wake the digest timer before Codex review", async () => {
    const sqlite = migratedSqlite();
    sqlite.exec(`
      INSERT INTO sources (id) VALUES ('source');
      UPDATE match_profiles
      SET enabled = 1, activation_watermark = '2026-08-10T12:00:00.000Z',
          next_digest_at = '2026-08-13T20:00:00.000Z';
      INSERT INTO jobs (
        id, source_id, title, company, location_region, skills, official_url, status, first_seen_at, last_seen_at
      ) VALUES (
        'wake', 'source', 'Data Science Intern', 'Acme', 'us', '["Python","SQL"]',
        'https://example.com/wake', 'open', '2026-08-13T16:00:00.000Z', '2026-08-13T16:00:00.000Z'
      );
      INSERT INTO job_topics (job_id, topic_key) VALUES ('wake', 'program:internship'), ('wake', 'year:2027');
    `);

    await syncResumeMatchesForUrls(
      createD1(sqlite), "source", ["https://example.com/wake"], "2026-08-13T16:01:00.000Z",
      ["https://example.com/wake"],
    );

    expect(sqlite.prepare("SELECT job_id, score, notification_eligible FROM job_matches").all()).toEqual([
      { job_id: "wake", score: 60, notification_eligible: 0 },
    ]);
    expect(sqlite.prepare("SELECT next_digest_at FROM match_profiles WHERE id = 'chanyoung-resume'").get())
      .toEqual({ next_digest_at: "2026-08-13T20:00:00.000Z" });
  });

  it("queues every newly seen US 2027 internship even when resume scoring has no role evidence", async () => {
    const sqlite = migratedSqlite();
    sqlite.exec(`
      INSERT INTO sources (id) VALUES ('source');
      UPDATE match_profiles
      SET enabled = 1, activation_watermark = '2026-08-10T12:00:00.000Z',
          next_digest_at = '2026-08-13T20:00:00.000Z';
      INSERT INTO jobs (
        id, source_id, title, company, location_region, official_url, status, first_seen_at, last_seen_at
      ) VALUES (
        'target', 'source', '2027 Human Resources Internship', 'Acme', 'us',
        'https://example.com/target', 'open', '2026-08-13T16:00:00.000Z', '2026-08-13T16:00:00.000Z'
      );
      INSERT INTO job_topics (job_id, topic_key) VALUES ('target', 'program:internship'), ('target', 'year:2027');
    `);

    await syncResumeMatchesForUrls(
      createD1(sqlite), "source", ["https://example.com/target"], "2026-08-13T16:01:00.000Z",
      ["https://example.com/target"],
    );

    expect(sqlite.prepare("SELECT is_active, notification_eligible FROM job_matches WHERE job_id = 'target'").get())
      .toEqual({ is_active: 1, notification_eligible: 0 });
    expect(sqlite.prepare("SELECT next_digest_at FROM match_profiles WHERE id = 'chanyoung-resume'").get())
      .toEqual({ next_digest_at: "2026-08-13T20:00:00.000Z" });
  });

  it("creates a new eligible match generation for a genuinely reopened job", async () => {
    const sqlite = migratedSqlite();
    sqlite.exec(`
      INSERT INTO sources (id) VALUES ('source');
      UPDATE match_profiles SET enabled = 1, activation_watermark = '2026-08-10T12:00:00.000Z';
      INSERT INTO jobs (
        id, source_id, title, company, location_region, official_url, status, first_seen_at, last_seen_at, open_generation,
        reopened_at
      ) VALUES (
        'reopened', 'source', 'Software Engineering Intern', 'Acme', 'us', 'https://example.com/reopened',
        'open', '2026-08-01T00:00:00.000Z', '2026-08-10T13:00:00.000Z', 2,
        '2026-08-10T13:00:00.000Z'
      );
    `);
    const candidate: ResumeMatchCandidate = {
      id: "reopened", title: "Software Engineering Intern", company: "Acme", locationRegion: "us",
      programKeys: ["internship"], summary: null, description: null, responsibilities: null,
      qualifications: null, skills: ["JavaScript"], jobFamily: null, jobFunction: null,
      educationRequirements: null, experienceRequirements: null, securityClearance: null,
      recruitingYears: [2027], publishedAt: null, firstSeenAt: "2026-08-01T00:00:00.000Z",
      reopenedAt: "2026-08-10T13:00:00.000Z", openGeneration: 2,
    };

    await syncResumeMatches(createD1(sqlite), [candidate], "2026-08-10T13:00:00.000Z");

    expect(sqlite.prepare(
      "SELECT open_generation, notification_eligible FROM job_matches WHERE job_id = 'reopened'",
    ).get()).toEqual({ open_generation: 2, notification_eligible: 0 });
  });

  it("does not notify a reopen that happened before activation", async () => {
    const sqlite = migratedSqlite();
    sqlite.exec(`
      INSERT INTO sources (id) VALUES ('source');
      UPDATE match_profiles SET enabled = 1, activation_watermark = '2026-08-10T12:00:00.000Z';
      INSERT INTO jobs (
        id, source_id, title, company, location_region, official_url, status, first_seen_at,
        last_seen_at, open_generation, reopened_at
      ) VALUES (
        'old-reopen', 'source', 'Software Engineering Intern', 'Acme', 'us',
        'https://example.com/old-reopen', 'open', '2026-08-01T00:00:00.000Z',
        '2026-08-10T13:00:00.000Z', 2, '2026-08-10T11:00:00.000Z'
      );
    `);
    const candidate: ResumeMatchCandidate = {
      id: "old-reopen", title: "Software Engineering Intern", company: "Acme", locationRegion: "us",
      programKeys: ["internship"], summary: null, description: null, responsibilities: null,
      qualifications: null, skills: ["JavaScript"], jobFamily: null, jobFunction: null,
      educationRequirements: null, experienceRequirements: null, securityClearance: null,
      recruitingYears: [2027], publishedAt: null, firstSeenAt: "2026-08-01T00:00:00.000Z",
      reopenedAt: "2026-08-10T11:00:00.000Z", openGeneration: 2,
    };

    await syncResumeMatches(createD1(sqlite), [candidate], "2026-08-10T13:00:00.000Z");

    expect(sqlite.prepare(
      "SELECT notification_eligible FROM job_matches WHERE job_id = 'old-reopen'",
    ).get()).toEqual({ notification_eligible: 0 });
  });

  it("uses the same smallest company/id canonical tie breaker as Jobs search", async () => {
    const sqlite = migratedSqlite();
    sqlite.exec(`
      INSERT INTO sources (id) VALUES ('source-a'), ('source-b');
      INSERT INTO jobs (
        id, source_id, title, company, location_region, skills, official_url, status, first_seen_at, last_seen_at
      ) VALUES
        ('a-small', 'source-a', 'Machine Learning Intern', 'Alpha', 'us', '["Python","SQL"]', 'https://example.com/shared', 'open',
          '2026-08-10T11:00:00.000Z', '2026-08-10T11:00:00.000Z'),
        ('z-large', 'source-b', 'Machine Learning Intern', 'Zulu', 'us', '["Python","SQL"]', 'https://example.com/shared', 'open',
          '2026-08-10T11:00:00.000Z', '2026-08-10T11:00:00.000Z');
      INSERT INTO job_topics (job_id, topic_key) VALUES
        ('a-small', 'program:internship'), ('a-small', 'year:2027'),
        ('z-large', 'program:internship'), ('z-large', 'year:2027');
    `);

    await backfillResumeMatches(createD1(sqlite), { afterId: null, limit: 100 });

    expect(sqlite.prepare("SELECT job_id FROM job_matches").all()).toEqual([{ job_id: "a-small" }]);
  });

  it("checks the profile before loading rich job rows", async () => {
    const sqlite = migratedSqlite();
    const raw = createD1(sqlite);
    const statements: string[] = [];
    const db = {
      ...raw,
      prepare(sql: string) {
        statements.push(sql);
        return raw.prepare(sql);
      },
    } as D1Database;

    expect(await syncResumeMatchesForUrls(
      db, "source", ["https://example.com/job"], "2026-08-10T12:00:00.000Z",
    )).toEqual({ matched: 0, deactivated: 0 });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("FROM match_profiles");
  });

  it("loads a 10k changed-job set in bounded candidate pages", async () => {
    const statements: string[] = [];
    const db = {
      prepare(sql: string) {
        statements.push(sql);
        return {
          bind() {
            return {
              all: async () => ({
                results: sql.includes("FROM match_profiles")
                  ? [{
                    id: "chanyoung-resume", keyword_id: "resume-keyword-chanyoung",
                    enabled: 1, activation_watermark: "2026-08-10T12:00:00.000Z",
                  }]
                  : [],
              }),
            };
          },
        };
      },
    } as unknown as D1Database;
    const urls = Array.from({ length: 10_000 }, (_, index) => `https://example.com/${index}`);

    expect(await syncResumeMatchesForUrls(
      db, "source", urls, "2026-08-10T13:00:00.000Z",
    )).toEqual({ matched: 0, deactivated: 0 });
    expect(statements).toHaveLength(11);
  });
});
