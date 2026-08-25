import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyCodexReviews, canonicalReviewUrl } from "./codex-review-store";

const createD1 = (sqlite: DatabaseSync): D1Database => ({
  prepare(sql: string) {
    const statement = sqlite.prepare(sql);
    const bind = (...values: unknown[]) => ({
      all: async <T>() => ({ results: statement.all(...values as never[]) as T[] }),
      first: async <T>() => statement.get(...values as never[]) as T | null,
      run: async () => statement.run(...values as never[]),
      __runSync: () => statement.run(...values as never[]),
    });
    return {
      all: async <T>() => ({ results: statement.all() as T[] }),
      first: async <T>() => statement.get() as T | null,
      run: async () => statement.run(),
      __runSync: () => statement.run(),
      bind,
    };
  },
  async batch(statements: D1PreparedStatement[]) {
    sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => (
        statement as D1PreparedStatement & { __runSync?: () => unknown }
      ));
      // The test adapter exposes the bound sqlite statement through its private
      // synchronous runner, mirroring the D1 batch contract.
      for (const statement of results) {
        const runner = statement.__runSync;
        if (!runner) throw new Error("Missing test D1 runner.");
        runner();
      }
      sqlite.exec("COMMIT");
      return [];
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  },
}) as unknown as D1Database;

const database = (): DatabaseSync => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE match_profiles (
      id TEXT PRIMARY KEY, keyword_id TEXT NOT NULL, enabled INTEGER NOT NULL,
      activation_watermark TEXT, next_digest_at TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY, official_url TEXT NOT NULL, apply_url TEXT, first_seen_at TEXT NOT NULL,
      reopened_at TEXT, status TEXT NOT NULL, open_generation INTEGER NOT NULL, company TEXT NOT NULL,
      title TEXT, location_region TEXT NOT NULL, employment_type TEXT,
      requisition_identity_key TEXT, external_identity_key TEXT, url_identity_key TEXT,
      alert_discovered_after_baseline INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE job_topics (job_id TEXT NOT NULL, topic_key TEXT NOT NULL);
    CREATE TABLE job_matches (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL, keyword_id TEXT NOT NULL, open_generation INTEGER NOT NULL,
      is_active INTEGER NOT NULL, notification_eligible INTEGER NOT NULL, notified_at TEXT
    );
    CREATE TABLE codex_reviews (
      id TEXT PRIMARY KEY, job_match_id TEXT UNIQUE NOT NULL, profile_id TEXT NOT NULL,
      decision TEXT NOT NULL, rationale TEXT NOT NULL, verified_url TEXT NOT NULL, source_file TEXT,
      reviewer TEXT NOT NULL, reviewed_at TEXT NOT NULL, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE notifications (id TEXT PRIMARY KEY, status TEXT NOT NULL, keyword_id TEXT);
    CREATE TABLE notification_items (id TEXT PRIMARY KEY, notification_id TEXT NOT NULL, job_match_id TEXT NOT NULL);
    CREATE TABLE notification_identity_history (
      profile_id TEXT NOT NULL, recipient TEXT NOT NULL, identity_key TEXT NOT NULL,
      first_sent_at TEXT NOT NULL, notification_id TEXT, job_match_id TEXT,
      PRIMARY KEY(profile_id, recipient, identity_key)
    );
    INSERT INTO match_profiles VALUES ('chanyoung-resume', 'resume-keyword-chanyoung', 1, '2026-08-13T10:00:00.000Z', '2026-08-13T20:00:00.000Z', CURRENT_TIMESTAMP);
    INSERT INTO jobs (id, official_url, apply_url, first_seen_at, reopened_at, status, open_generation, company, location_region, employment_type)
      VALUES ('job-new', 'https://careers.example.com/job-new', 'https://careers.example.com/apply-new', '2026-08-13T12:00:00.000Z', NULL, 'open', 1, 'Acme', 'us', 'Internship');
    INSERT INTO job_topics VALUES ('job-new', 'program:internship'), ('job-new', 'year:2027');
    INSERT INTO job_matches VALUES ('match-new', 'job-new', 'resume-keyword-chanyoung', 1, 1, 0, NULL);
    UPDATE jobs SET url_identity_key = 'url:https://careers.example.com/job-new' WHERE id = 'job-new';
  `);
  return sqlite;
};

describe("Codex review persistence", () => {
  it("approves only a current internship match and wakes Gmail dispatch", async () => {
    const sqlite = database();
    const result = await applyCodexReviews(createD1(sqlite), [{
      officialUrl: "https://careers.example.com/job-new",
      decision: "approve",
      rationale: "US internship with direct software engineering responsibilities.",
      verifiedUrl: "https://careers.example.com/job-new",
      sourceFile: "candidate.json",
    }], "2026-08-13T13:00:00.000Z");

    expect(result).toMatchObject({ accepted: 1, approved: 1, rejected: 0, missing: [] });
    expect(sqlite.prepare("SELECT notification_eligible FROM job_matches WHERE id = 'match-new'").get())
      .toEqual({ notification_eligible: 1 });
    expect(sqlite.prepare("SELECT decision, verified_url FROM codex_reviews").get())
      .toEqual({ decision: "approve", verified_url: "https://careers.example.com/job-new" });
    expect(sqlite.prepare("SELECT next_digest_at FROM match_profiles").get())
      .toEqual({ next_digest_at: "2026-08-13T13:00:00.000Z" });
  });

  it("accepts a current co-op match for the same Codex approval workflow", async () => {
    const sqlite = database();
    sqlite.exec(`
      INSERT INTO jobs (
        id, official_url, apply_url, first_seen_at, reopened_at, status, open_generation,
        company, title, location_region, employment_type, url_identity_key
      ) VALUES (
        'job-coop', 'https://careers.example.com/job-coop', NULL,
        '2026-08-13T12:30:00.000Z', NULL, 'open', 1, 'Acme',
        'Data Engineering Co-op 2027', 'us', 'Co-op',
        'url:https://careers.example.com/job-coop'
      );
      INSERT INTO job_topics VALUES ('job-coop', 'program:coop'), ('job-coop', 'year:2027');
      INSERT INTO job_matches VALUES ('match-coop', 'job-coop', 'resume-keyword-chanyoung', 1, 1, 0, NULL);
    `);

    const result = await applyCodexReviews(createD1(sqlite), [{
      officialUrl: "https://careers.example.com/job-coop",
      decision: "approve",
      rationale: "US 2027 co-op with relevant data engineering work; work-term dates require verification.",
      verifiedUrl: "https://careers.example.com/job-coop",
    }], "2026-08-13T13:00:00.000Z");

    expect(result).toMatchObject({ accepted: 1, approved: 1, rejected: 0, missing: [] });
    expect(sqlite.prepare("SELECT notification_eligible FROM job_matches WHERE id = 'match-coop'").get())
      .toEqual({ notification_eligible: 1 });
  });

  it("leaves region and recruiting-year adjudication to Codex", async () => {
    const sqlite = database();
    sqlite.prepare("UPDATE jobs SET location_region = 'non_us' WHERE id = 'job-new'").run();
    sqlite.prepare("DELETE FROM job_topics WHERE job_id = 'job-new' AND topic_key = 'year:2027'").run();
    const result = await applyCodexReviews(createD1(sqlite), [{
      officialUrl: "https://careers.example.com/job-new",
      decision: "reject",
      rationale: "The reviewed posting is outside the United States and is not a 2027 recruiting cycle.",
      verifiedUrl: "https://careers.example.com/job-new",
    }]);
    expect(result).toMatchObject({ accepted: 1, approved: 0, rejected: 1, missing: [] });
    expect(sqlite.prepare("SELECT decision FROM codex_reviews").get()).toEqual({ decision: "reject" });
  });

  it("fails closed for URL mismatches but leaves baseline adjudication to Codex", async () => {
    const sqlite = database();
    const result = await applyCodexReviews(createD1(sqlite), [{
      officialUrl: "https://careers.example.com/job-new",
      decision: "approve",
      rationale: "Looks relevant.",
      verifiedUrl: "https://evil.example/job-new",
    }]);
    expect(result.missing[0]?.reason).toBe("verified_url_does_not_match_official_url");
    expect(sqlite.prepare("SELECT count(*) AS total FROM codex_reviews").get()).toEqual({ total: 0 });

    sqlite.prepare("UPDATE jobs SET first_seen_at = '2026-08-13T09:00:00.000Z'").run();
    const old = await applyCodexReviews(createD1(sqlite), [{
      officialUrl: "https://careers.example.com/job-new",
      decision: "reject",
      rationale: "Codex verified this is baseline inventory and rejected it.",
      verifiedUrl: "https://careers.example.com/job-new",
    }]);
    expect(old).toMatchObject({ accepted: 1, approved: 0, rejected: 1, missing: [] });
    expect(sqlite.prepare("SELECT decision FROM codex_reviews WHERE job_match_id = 'match-new'").get())
      .toEqual({ decision: "reject" });
  });

  it("persists but suppresses a later review when the durable posting identity was already sent", async () => {
    const sqlite = database();
    sqlite.prepare(`INSERT INTO notification_identity_history
      VALUES ('chanyoung-resume', 'kimchany@usc.edu', 'url:https://careers.example.com/job-new',
              '2026-08-13T12:30:00.000Z', 'notification-1', 'older-match')`).run();

    const result = await applyCodexReviews(createD1(sqlite), [{
      officialUrl: "https://careers.example.com/job-new",
      decision: "approve",
      rationale: "Relevant internship.",
      verifiedUrl: "https://careers.example.com/job-new",
    }]);

    expect(result).toMatchObject({ accepted: 1, approved: 0, rejected: 0, missing: [] });
    expect(result.suppressedAlreadyNotified).toEqual([{
      jobId: "job-new", officialUrl: "https://careers.example.com/job-new",
    }]);
    expect(sqlite.prepare("SELECT decision FROM codex_reviews").get()).toEqual({ decision: "approve" });
    expect(sqlite.prepare("SELECT notification_eligible FROM job_matches").get())
      .toEqual({ notification_eligible: 0 });
  });

  it("accepts harmless tracking and trailing-slash variants of the verified official URL", async () => {
    const sqlite = database();
    const result = await applyCodexReviews(createD1(sqlite), [{
      jobId: "job-new",
      decision: "reject",
      rationale: "Official posting date could not be verified.",
      verifiedUrl: "https://careers.example.com/job-new/?utm_source=handshake&gclid=123#apply",
    }]);

    expect(result).toMatchObject({ accepted: 1, rejected: 1, missing: [] });
    expect(canonicalReviewUrl("https://e.example/job/?b=2&utm_medium=x&a=1#top"))
      .toBe("https://e.example/job?a=1&b=2");
  });

  it("rejects an oversized review batch instead of silently truncating it", async () => {
    await expect(applyCodexReviews(createD1(database()), Array.from({ length: 101 }, () => ({
      jobId: "job-new",
      decision: "reject" as const,
      rationale: "Not eligible.",
      verifiedUrl: "https://careers.example.com/job-new",
    })))).rejects.toThrow("limited to 100 rows");
  });

  it("rejects non-approve/reject decisions and leaves the match pending", async () => {
    const sqlite = database();
    const result = await applyCodexReviews(createD1(sqlite), [{
      officialUrl: "https://careers.example.com/job-new",
      decision: "hold" as never,
      rationale: "Need to confirm the program year.",
      verifiedUrl: "https://careers.example.com/job-new",
    }]);
    expect(result.missing[0]?.reason).toBe("invalid_review_payload");
    expect(sqlite.prepare("SELECT notification_eligible FROM job_matches").get())
      .toEqual({ notification_eligible: 0 });
  });
});
