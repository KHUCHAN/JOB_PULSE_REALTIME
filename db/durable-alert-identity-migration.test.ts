import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("durable posting alert identity migration", () => {
  it("baselines existing inventory, backfills sent identities without scanning every job, and clears only unsent envelopes", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE sources (id TEXT PRIMARY KEY);
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, external_id TEXT, requisition_id TEXT,
        official_url TEXT NOT NULL
      );
      CREATE TABLE match_profiles (
        id TEXT PRIMARY KEY, keyword_id TEXT NOT NULL, activation_watermark TEXT,
        next_digest_at TEXT, dispatch_lease_owner TEXT, dispatch_lease_expires_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE job_matches (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL, keyword_id TEXT NOT NULL,
        notification_eligible INTEGER NOT NULL, notified_at TEXT
      );
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY, keyword_id TEXT, status TEXT NOT NULL,
        sent_at TEXT, scheduled_at TEXT
      );
      CREATE TABLE notification_items (
        id TEXT PRIMARY KEY, notification_id TEXT NOT NULL,
        job_match_id TEXT NOT NULL, recipient TEXT NOT NULL
      );
      INSERT INTO sources VALUES ('p4-0225-barclays-us');
      INSERT INTO jobs VALUES (
        'job-1', 'p4-0225-barclays-us', 'JR-0000128099', 'JR-0000128099',
        'https://search.jobs.barclays/en/job/new-york/role/13015/99217260160/apply#form'
      );
      INSERT INTO match_profiles VALUES (
        'chanyoung-resume', 'resume-keyword', '2026-08-12T00:00:00.000Z',
        '2026-08-16T00:00:00.000Z', NULL, NULL, CURRENT_TIMESTAMP
      );
      INSERT INTO job_matches VALUES ('match-1', 'job-1', 'resume-keyword', 1, NULL);
      INSERT INTO notifications VALUES
        ('sent-1', 'resume-keyword', 'sent', '2026-08-15T10:00:00.000Z', '2026-08-15T10:00:00.000Z'),
        ('queued-1', 'resume-keyword', 'queued', NULL, '2026-08-16T10:00:00.000Z');
      INSERT INTO notification_items VALUES
        ('sent-item', 'sent-1', 'match-1', 'kimchany@usc.edu'),
        ('queued-item', 'queued-1', 'match-1', 'kimchany@usc.edu');
    `);

    const migration = readFileSync("drizzle/0113_durable_posting_alert_identity.sql", "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      sqlite.exec(statement);
    }

    expect(sqlite.prepare(`SELECT alert_discovered_after_baseline, requisition_identity_key,
      external_identity_key, url_identity_key FROM jobs`).get()).toEqual({
      alert_discovered_after_baseline: 0,
      requisition_identity_key: null,
      external_identity_key: null,
      url_identity_key: null,
    });
    expect(sqlite.prepare("SELECT count(*) AS total FROM notification_identity_history").get())
      .toEqual({ total: 3 });
    expect(sqlite.prepare("SELECT id FROM notifications ORDER BY id").all()).toEqual([{ id: "sent-1" }]);
    expect(sqlite.prepare("SELECT notification_eligible FROM job_matches").get())
      .toEqual({ notification_eligible: 1 });
    expect(sqlite.prepare("SELECT alert_baseline_at IS NOT NULL AS ready FROM sources").get())
      .toEqual({ ready: 1 });
  });
});
