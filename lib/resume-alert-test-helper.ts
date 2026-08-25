import { DatabaseSync } from "node:sqlite";

export const createD1ForSqlite = (sqlite: DatabaseSync): D1Database => ({
  prepare(sql: string) {
    const statement = sqlite.prepare(sql);
    const api = (values: unknown[]) => ({
      all: async <T>() => ({ results: statement.all(...values as never[]) as T[] }),
      first: async <T>() => statement.get(...values as never[]) as T | null,
      run: async () => statement.run(...values as never[]),
      __runSync: () => statement.run(...values as never[]),
    });
    return { ...api([]), bind: (...values: unknown[]) => api(values) };
  },
  async batch(statements: D1PreparedStatement[]) {
    sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => (
        statement as D1PreparedStatement & { __runSync: () => unknown }
      ).__runSync());
      sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  },
}) as unknown as D1Database;

export const alertDatabaseWithMatches = (matchCount = 2): DatabaseSync => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE match_profiles (
      id TEXT PRIMARY KEY, keyword_id TEXT NOT NULL, enabled INTEGER NOT NULL,
      activation_watermark TEXT, next_digest_at TEXT, dispatch_lease_owner TEXT,
      dispatch_lease_expires_at TEXT, gmail_state TEXT NOT NULL DEFAULT 'connected',
      last_digest_at TEXT, last_error TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE profile_recipients (
      profile_id TEXT NOT NULL, recipient TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(profile_id, recipient)
    );
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY, company TEXT NOT NULL, title TEXT NOT NULL, location TEXT,
      official_url TEXT NOT NULL, apply_url TEXT, published_at TEXT, first_seen_at TEXT NOT NULL,
      employment_type TEXT,
      status TEXT NOT NULL, open_generation INTEGER NOT NULL,
      requisition_identity_key TEXT, external_identity_key TEXT, url_identity_key TEXT,
      alert_discovered_after_baseline INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE job_topics (job_id TEXT NOT NULL, topic_key TEXT NOT NULL);
    CREATE TABLE job_matches (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL, keyword_id TEXT NOT NULL, score INTEGER NOT NULL,
      matched_terms TEXT NOT NULL, open_generation INTEGER NOT NULL, is_active INTEGER NOT NULL,
      notification_eligible INTEGER NOT NULL, notified_at TEXT
    );
    CREATE TABLE codex_reviews (
      id TEXT PRIMARY KEY, job_match_id TEXT NOT NULL, profile_id TEXT NOT NULL,
      decision TEXT NOT NULL, rationale TEXT, verified_url TEXT,
      reviewed_at TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY, keyword_id TEXT, channel TEXT NOT NULL, recipient TEXT NOT NULL,
      status TEXT NOT NULL, job_count INTEGER NOT NULL, provider_message_id TEXT,
      scheduled_at TEXT NOT NULL, sent_at TEXT, error TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT, lease_owner TEXT, lease_expires_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE notification_items (
      id TEXT PRIMARY KEY, notification_id TEXT NOT NULL, job_match_id TEXT NOT NULL,
      recipient TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(job_match_id, recipient)
    );
    CREATE TABLE notification_identity_history (
      profile_id TEXT NOT NULL, recipient TEXT NOT NULL, identity_key TEXT NOT NULL,
      first_sent_at TEXT NOT NULL, notification_id TEXT, job_match_id TEXT,
      PRIMARY KEY(profile_id, recipient, identity_key)
    );
    INSERT INTO match_profiles (id, keyword_id, enabled, next_digest_at)
      VALUES ('chanyoung-resume', 'resume-keyword-chanyoung', 1, '2026-08-10T12:00:00.000Z');
    INSERT INTO profile_recipients VALUES
      ('chanyoung-resume', 'kimchany@usc.edu', 1),
      ('chanyoung-resume', 'lupeter@usc.edu', 1);
  `);
  for (let index = 1; index <= matchCount; index += 1) {
    sqlite.prepare(`INSERT INTO jobs (id, company, title, location, official_url, apply_url, published_at, first_seen_at, employment_type, status, open_generation, url_identity_key)
      VALUES (?, 'Acme', ?, 'Los Angeles, CA', ?, NULL, NULL, ?, 'Internship', 'open', 1, ?)`).run(
      `job-${index}`, `Machine Learning Intern ${index}`, `https://example.com/${index}`, "2026-08-10T12:01:00.000Z",
      `url:https://example.com/${index}`,
    );
    sqlite.prepare(`INSERT INTO job_matches VALUES (?, ?, 'resume-keyword-chanyoung', 92, ?, 1, 1, 1, NULL)`).run(
      `match-${index}`, `job-${index}`, '["role:ai-ml|AI or machine learning role|35"]',
    );
    sqlite.prepare(`INSERT INTO codex_reviews (
      id, job_match_id, profile_id, decision, rationale, verified_url, reviewed_at
    ) VALUES (?, ?, 'chanyoung-resume', 'approve', 'Codex approved this exact job.', ?, '2026-08-10T12:01:00.000Z')`).run(
      `review-${index}`, `match-${index}`, `https://example.com/${index}`,
    );
  }
  return sqlite;
};
