import { describe, expect, it } from "vitest";
import { claimDueNotifications, planResumeDigests } from "./resume-alert-store";
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
