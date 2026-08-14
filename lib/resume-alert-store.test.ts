import { describe, expect, it } from "vitest";
import { claimDueNotifications, clearResumeAlertBacklog, planResumeDigests, purgeCoopResumeNotifications } from "./resume-alert-store";
import { alertDatabaseWithMatches, createD1ForSqlite } from "./resume-alert-test-helper";

describe("resume digest reservation", () => {
  it("reserves one item per recipient and never duplicates a sent pair", async () => {
    const sqlite = alertDatabaseWithMatches(2);
    const db = createD1ForSqlite(sqlite);

    const first = await planResumeDigests(db, "chanyoung-resume", "2026-08-10T12:00:00.000Z", 25);
    const second = await planResumeDigests(db, "chanyoung-resume", "2026-08-10T12:00:00.000Z", 25);

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(0);
    expect(sqlite.prepare("SELECT count(*) AS total FROM notification_items").get()).toEqual({ total: 4 });
  });

  it("accepts a digest that becomes due within the scheduler boundary window", async () => {
    const sqlite = alertDatabaseWithMatches(1);
    sqlite.prepare("UPDATE match_profiles SET next_digest_at = '2026-08-10T12:00:30.000Z'").run();

    const planned = await planResumeDigests(
      createD1ForSqlite(sqlite), "chanyoung-resume", "2026-08-10T12:00:00.000Z", 25,
    );

    expect(planned).toHaveLength(2);
  });

  it("splits more than 25 jobs into deterministic parts up to the four-message cap", async () => {
    const sqlite = alertDatabaseWithMatches(60);
    const planned = await planResumeDigests(
      createD1ForSqlite(sqlite), "chanyoung-resume", "2026-08-10T12:00:00.000Z", 25,
    );

    expect(planned.map((item) => item.jobCount)).toEqual([25, 25, 25, 25]);
    expect(sqlite.prepare("SELECT count(*) AS total FROM notification_items").get()).toEqual({ total: 100 });
    expect(sqlite.prepare(
      "SELECT recipient, count(*) AS total FROM notifications GROUP BY recipient ORDER BY recipient",
    ).all()).toEqual([
      { recipient: "kimchany@usc.edu", total: 2 },
      { recipient: "lupeter@usc.edu", total: 2 },
    ]);
    expect(sqlite.prepare("SELECT next_digest_at FROM match_profiles").get()).toEqual({
      next_digest_at: "2026-08-10T12:00:00.000Z",
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

    expect(claimed).toHaveLength(2);
    expect(claimed.every((notification) => notification.jobs[0]?.officialUrl === "https://example.com/1")).toBe(true);
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

  it("purges a stale co-op item before Gmail can claim it", async () => {
    const sqlite = alertDatabaseWithMatches(0);
    sqlite.prepare(`INSERT INTO jobs (id, company, title, location, official_url, first_seen_at, employment_type, status, open_generation)
      VALUES ('coop-job', 'IBM', 'Data Engineer Intern 2027', 'Dallas, TX', 'https://careers.ibm.com/jobs/128639', '2026-08-14T12:00:00.000Z', 'Co-op', 'open', 1)`).run();
    sqlite.prepare(`INSERT INTO job_matches VALUES ('coop-match', 'coop-job', 'resume-keyword-chanyoung', 95, '[]', 1, 1, 1, NULL)`).run();
    sqlite.prepare(`INSERT INTO notifications (id, keyword_id, channel, recipient, status, job_count, scheduled_at)
      VALUES ('coop-notification', 'resume-keyword-chanyoung', 'email', 'kimchany@usc.edu', 'queued', 1, '2026-08-14T12:00:00.000Z')`).run();
    sqlite.prepare(`INSERT INTO notification_items (id, notification_id, job_match_id, recipient)
      VALUES ('coop-item', 'coop-notification', 'coop-match', 'kimchany@usc.edu')`).run();

    await purgeCoopResumeNotifications(createD1ForSqlite(sqlite), "chanyoung-resume");

    expect(sqlite.prepare("SELECT notification_eligible FROM job_matches WHERE id = 'coop-match'").get())
      .toEqual({ notification_eligible: 0 });
    expect(sqlite.prepare("SELECT count(*) AS total FROM notifications").get()).toEqual({ total: 0 });
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
