import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

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
      official_url text NOT NULL,
      status text NOT NULL DEFAULT 'open',
      first_seen_at text NOT NULL,
      last_seen_at text NOT NULL,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_id, official_url)
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
    expect(sqlite.prepare("SELECT recipient FROM profile_recipients ORDER BY recipient").all()).toEqual([
      { recipient: "kimchany@usc.edu" },
      { recipient: "lupeter@usc.edu" },
    ]);
    expect(() => sqlite.prepare(
      "INSERT INTO profile_recipients (profile_id, recipient, enabled) VALUES (?, ?, 1)",
    ).run("chanyoung-resume", "kimchany@usc.edu")).toThrow();
  });
});
