import { describe, expect, it } from "vitest";
import {
  claimDueNotifications,
  clearResumeAlertBacklog,
  getResumeAlertStatus,
  markNotificationSent,
  planResumeDigests,
} from "./resume-alert-store";
import { alertDatabaseWithMatches, createD1ForSqlite } from "./resume-alert-test-helper";

describe("resume digest reservation", () => {
  it("reserves one item per recipient and never duplicates a sent pair", async () => {
    const sqlite = alertDatabaseWithMatches(2);
    const db = createD1ForSqlite(sqlite);

    const first = await planResumeDigests(db, "chanyoung-resume", "2026-08-10T12:00:00.000Z", 25);
    const second = await planResumeDigests(db, "chanyoung-resume", "2026-08-10T12:00:00.000Z", 25);

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      recipient: "kimchany@usc.edu, lupeter@usc.edu",
      jobCount: 2,
    });
    expect(second).toHaveLength(0);
    expect(sqlite.prepare("SELECT count(*) AS total FROM notification_items").get()).toEqual({ total: 4 });
  });

  it("accepts a digest that becomes due within the scheduler boundary window", async () => {
    const sqlite = alertDatabaseWithMatches(1);
    sqlite.prepare("UPDATE match_profiles SET next_digest_at = '2026-08-10T12:00:30.000Z'").run();

    const planned = await planResumeDigests(
      createD1ForSqlite(sqlite), "chanyoung-resume", "2026-08-10T12:00:00.000Z", 500, 1,
    );

    expect(planned).toHaveLength(1);
  });

  it("keeps the complete Codex review batch in one digest", async () => {
    const sqlite = alertDatabaseWithMatches(60);
    const planned = await planResumeDigests(
      createD1ForSqlite(sqlite), "chanyoung-resume", "2026-08-10T12:00:00.000Z", 500, 1,
    );

    expect(planned.map((item) => item.jobCount)).toEqual([60]);
    expect(sqlite.prepare("SELECT count(*) AS total FROM notification_items").get()).toEqual({ total: 120 });
    expect(sqlite.prepare(
      "SELECT recipient, count(*) AS total FROM notifications GROUP BY recipient ORDER BY recipient",
    ).all()).toEqual([
      { recipient: "kimchany@usc.edu, lupeter@usc.edu", total: 1 },
    ]);
    expect(sqlite.prepare("SELECT next_digest_at FROM match_profiles").get()).toEqual({
      next_digest_at: "2026-08-10T14:00:00.000Z",
    });
  });

  it("does not claim notifications when the resume profile is disabled or Gmail blocked", async () => {
    const sqlite = alertDatabaseWithMatches(1);
    const db = createD1ForSqlite(sqlite);
    await planResumeDigests(db, "chanyoung-resume", "2026-08-10T12:00:00.000Z", 25);
    sqlite.prepare("UPDATE match_profiles SET enabled = 0, gmail_state = 'blocked'").run();

    expect(await claimDueNotifications(db, "chanyoung-resume", "2026-08-10T12:00:01.000Z", 4)).toEqual([]);
  });

  it("uses the stable official posting URL in email digests", async () => {
    const sqlite = alertDatabaseWithMatches(1);
    sqlite.prepare("UPDATE jobs SET apply_url = 'https://example.com/1/apply-session'").run();
    const db = createD1ForSqlite(sqlite);
    await planResumeDigests(db, "chanyoung-resume", "2026-08-10T12:00:00.000Z", 25);

    const claimed = await claimDueNotifications(db, "chanyoung-resume", "2026-08-10T12:00:01.000Z", 4);

    expect(claimed).toHaveLength(1);
    expect(claimed[0].recipient).toBe("kimchany@usc.edu, lupeter@usc.edu");
    expect(claimed[0].jobs).toHaveLength(1);
    expect(claimed[0].jobs[0]?.officialUrl).toBe("https://example.com/1");
  });

  it("never reserves a URL variant after the same requisition was sent", async () => {
    const sqlite = alertDatabaseWithMatches(1);
    sqlite.prepare("UPDATE jobs SET requisition_identity_key = 'req:acme:req-42' WHERE id = 'job-1'").run();
    const db = createD1ForSqlite(sqlite);
    await planResumeDigests(db, "chanyoung-resume", "2026-08-10T12:00:00.000Z", 500, 1);
    const [claimed] = await claimDueNotifications(db, "chanyoung-resume", "2026-08-10T12:00:01.000Z", 1);
    await markNotificationSent(db, claimed.id, "gmail-message-1", "2026-08-10T12:00:02.000Z");

    sqlite.exec(`
      UPDATE match_profiles SET next_digest_at = '2026-08-10T12:01:00.000Z';
      INSERT INTO jobs (
        id, company, title, location, official_url, first_seen_at, employment_type,
        status, open_generation, requisition_identity_key, url_identity_key
      ) VALUES (
        'job-variant', 'Acme', 'Machine Learning Intern', 'Los Angeles, CA',
        'https://example.com/1/apply', '2026-08-10T12:02:00.000Z', 'Internship',
        'open', 2, 'req:acme:req-42', 'url:https://example.com/1'
      );
      INSERT INTO job_matches VALUES (
        'match-variant', 'job-variant', 'resume-keyword-chanyoung', 95, '[]', 2, 1, 1, NULL
      );
    `);

    expect(await planResumeDigests(
      db, "chanyoung-resume", "2026-08-10T12:02:01.000Z", 500, 1,
    )).toEqual([]);
    expect(sqlite.prepare("SELECT count(*) AS total FROM notification_identity_history").get())
      .toEqual({ total: 4 });
  });

  it("reports canonical approved jobs that are still waiting for an email envelope", async () => {
    const sqlite = alertDatabaseWithMatches(1);

    const status = await getResumeAlertStatus(
      createD1ForSqlite(sqlite), "chanyoung-resume", true, "kimchany@usc.edu",
    );

    expect(status.queuedJobs).toBe(1);
  });

  it("plans a Codex-approved row even when crawler baseline metadata is false", async () => {
    const sqlite = alertDatabaseWithMatches(1);
    sqlite.prepare("UPDATE jobs SET alert_discovered_after_baseline = 0").run();
    const db = createD1ForSqlite(sqlite);

    const status = await getResumeAlertStatus(db, "chanyoung-resume", true, "kimchany@usc.edu");
    const planned = await planResumeDigests(
      db, "chanyoung-resume", "2026-08-10T12:00:00.000Z", 500, 1,
    );

    expect(status.queuedJobs).toBe(1);
    expect(planned).toHaveLength(1);
    expect(planned[0]?.jobCount).toBe(1);
  });

  it("clears unsent backlog before switching to insert-only notifications", async () => {
    const sqlite = alertDatabaseWithMatches(1);
    const db = createD1ForSqlite(sqlite);
    await planResumeDigests(db, "chanyoung-resume", "2026-08-10T12:00:00.000Z", 25);

    await clearResumeAlertBacklog(db, "chanyoung-resume");

    expect(sqlite.prepare("SELECT count(*) AS total FROM notifications").get()).toEqual({ total: 0 });
    expect(sqlite.prepare("SELECT count(*) AS total FROM notification_items").get()).toEqual({ total: 0 });
    expect(sqlite.prepare("SELECT notification_eligible FROM job_matches").get()).toEqual({ notification_eligible: 0 });
  });

  it("includes an approved co-op and warns when its work-term dates are unknown", async () => {
    const sqlite = alertDatabaseWithMatches(0);
    sqlite.prepare(`INSERT INTO jobs (id, company, title, location, official_url, first_seen_at, employment_type, status, open_generation)
      VALUES ('coop-job', 'IBM', 'Data Engineer Intern 2027', 'Dallas, TX', 'https://careers.ibm.com/jobs/128639', '2026-08-14T12:00:00.000Z', 'Co-op', 'open', 1)`).run();
    sqlite.prepare(`INSERT INTO job_matches VALUES ('coop-match', 'coop-job', 'resume-keyword-chanyoung', 95, '[]', 1, 1, 1, NULL)`).run();
    sqlite.prepare("INSERT INTO job_topics VALUES ('coop-job', 'program:coop')").run();
    const db = createD1ForSqlite(sqlite);

    const planned = await planResumeDigests(db, "chanyoung-resume", "2026-08-14T12:00:00.000Z", 25);
    const claimed = await claimDueNotifications(db, "chanyoung-resume", "2026-08-14T12:00:01.000Z", 1);

    expect(planned).toHaveLength(1);
    expect(claimed[0]?.jobs[0]).toMatchObject({
      program: "Co-op",
      scheduleNote: "Work-term dates not stated; verify possible semester overlap",
    });
  });

  it("rolls back an interrupted envelope reservation and keeps the digest due", async () => {
    const sqlite = alertDatabaseWithMatches(2);
    const raw = createD1ForSqlite(sqlite);
    const db = {
      ...raw,
      async batch(statements: D1PreparedStatement[]) {
        sqlite.exec("BEGIN");
        try {
          (statements[0] as D1PreparedStatement & { __runSync: () => unknown }).__runSync();
          throw new Error("injected item reservation failure");
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    } as unknown as D1Database;

    await expect(planResumeDigests(
      db, "chanyoung-resume", "2026-08-10T12:00:00.000Z", 25,
    )).rejects.toThrow("injected item reservation failure");
    expect(sqlite.prepare("SELECT count(*) AS total FROM notifications").get()).toEqual({ total: 0 });
    expect(sqlite.prepare(
      "SELECT next_digest_at, dispatch_lease_owner FROM match_profiles",
    ).get()).toEqual({ next_digest_at: "2026-08-10T12:00:00.000Z", dispatch_lease_owner: null });
  });
});
