import { describe, expect, it, vi } from "vitest";
import { alertDatabaseWithMatches, createD1ForSqlite } from "./resume-alert-test-helper";
import { planResumeDigests } from "./resume-alert-store";
import { processDueResumeAlerts, resumeAlertHttpStatus, sendResumeTestEmail } from "./resume-alert-service";

const config = {
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "refresh",
  sender: "kimchany@usc.edu",
  siteUrl: "https://job-pulse-realtime.cksdud985.chatgpt.site/jobs?resumeMatch=chanyoung-resume",
};

describe("resume alert delivery service", () => {
  it("surfaces delivery failures as a failed scheduled action", () => {
    expect(resumeAlertHttpStatus({ planned: 0, sent: 0, retryable: 0, authBlocked: 0, failed: 0, skipped: false })).toBe(200);
    expect(resumeAlertHttpStatus({ planned: 1, sent: 0, retryable: 1, authBlocked: 0, failed: 0, skipped: false })).toBe(502);
    expect(resumeAlertHttpStatus({ planned: 1, sent: 0, retryable: 0, authBlocked: 1, failed: 0, skipped: false })).toBe(502);
    expect(resumeAlertHttpStatus({ error: "delivery failed" })).toBe(502);
  });

  it("sends one digest message to all enabled recipients", async () => {
    const sqlite = alertDatabaseWithMatches(1);
    const responses = [
      new Response(JSON.stringify({ access_token: "access-1" }), { status: 200 }),
      new Response(JSON.stringify({ id: "message-1" }), { status: 200 }),
    ];
    const fetcher = vi.fn(async () => responses.shift()!);

    const result = await processDueResumeAlerts(
      createD1ForSqlite(sqlite),
      config,
      new Date("2026-08-10T12:00:00.000Z"),
      fetcher,
    );

    expect(result).toMatchObject({ planned: 1, sent: 1, retryable: 0, authBlocked: 0, failed: 0 });
    expect(sqlite.prepare("SELECT recipient, status FROM notifications ORDER BY recipient").all()).toEqual([
      { recipient: "kimchany@usc.edu, lupeter@usc.edu", status: "sent" },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("sends only the exact Codex batch and leaves older approvals pending", async () => {
    const sqlite = alertDatabaseWithMatches(3);
    const database = createD1ForSqlite(sqlite);
    await planResumeDigests(
      database,
      "chanyoung-resume",
      "2026-08-10T11:59:00.000Z",
      1,
      1,
      ["job-1"],
    );
    sqlite.prepare("UPDATE match_profiles SET next_digest_at = '2026-08-10T12:00:00.000Z'").run();
    const responses = [
      new Response(JSON.stringify({ access_token: "access-exact" }), { status: 200 }),
      new Response(JSON.stringify({ id: "message-exact" }), { status: 200 }),
    ];
    const fetcher = vi.fn(async () => responses.shift()!);

    const result = await processDueResumeAlerts(
      database,
      config,
      new Date("2026-08-10T12:00:00.000Z"),
      fetcher,
      ["job-2"],
    );

    expect(result).toMatchObject({ planned: 1, sent: 1, failed: 0 });
    expect(sqlite.prepare(`
      SELECT j.id, n.status FROM notification_items ni
      JOIN notifications n ON n.id = ni.notification_id
      JOIN job_matches jm ON jm.id = ni.job_match_id
      JOIN jobs j ON j.id = jm.job_id
      GROUP BY j.id, n.status ORDER BY j.id
    `).all()).toEqual([
      { id: "job-1", status: "queued" },
      { id: "job-2", status: "sent" },
    ]);
    expect(sqlite.prepare("SELECT count(*) AS total FROM job_matches WHERE notification_eligible = 1 AND notified_at IS NULL").get())
      .toEqual({ total: 2 });
  });

  it("marks Gmail blocked when authorization is revoked", async () => {
    const sqlite = alertDatabaseWithMatches(1);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));

    const result = await processDueResumeAlerts(
      createD1ForSqlite(sqlite), config, new Date("2026-08-10T12:00:00.000Z"), fetcher,
    );

    expect(result.authBlocked).toBe(1);
    expect(sqlite.prepare("SELECT gmail_state FROM match_profiles").get()).toEqual({ gmail_state: "blocked" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare("SELECT recipient, status FROM notifications ORDER BY recipient").all()).toEqual([
      { recipient: "kimchany@usc.edu, lupeter@usc.edu", status: "auth_blocked" },
    ]);
  });

  it("reports a transient test failure without treating OAuth as blocked", async () => {
    const responses = [
      new Response(JSON.stringify({ access_token: "access-1" }), { status: 200 }),
      new Response("temporary", { status: 503 }),
      new Response(JSON.stringify({ access_token: "access-2" }), { status: 200 }),
      new Response(JSON.stringify({ id: "message-2" }), { status: 200 }),
    ];
    const fetcher = vi.fn(async () => responses.shift()!);

    const result = await sendResumeTestEmail(
      config, ["kimchany@usc.edu", "lupeter@usc.edu"], fetcher,
    );

    expect(result).toEqual({ sent: 1, failed: 1, authBlocked: 0, retryable: 1, permanent: 0 });
  });
});
