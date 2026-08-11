import { describe, expect, it, vi } from "vitest";
import { alertDatabaseWithMatches, createD1ForSqlite } from "./resume-alert-test-helper";
import { processDueResumeAlerts, sendResumeTestEmail } from "./resume-alert-service";

const config = {
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "refresh",
  sender: "kimchany@usc.edu",
  siteUrl: "https://job-pulse-realtime.cksdud985.chatgpt.site/jobs?resumeMatch=chanyoung-resume",
};

describe("resume alert delivery service", () => {
  it("keeps only the failed recipient retryable", async () => {
    const sqlite = alertDatabaseWithMatches(1);
    const responses = [
      new Response(JSON.stringify({ access_token: "access-1" }), { status: 200 }),
      new Response(JSON.stringify({ id: "message-1" }), { status: 200 }),
      new Response(JSON.stringify({ access_token: "access-2" }), { status: 200 }),
      new Response("temporary", { status: 503 }),
    ];
    const fetcher = vi.fn(async () => responses.shift()!);

    const result = await processDueResumeAlerts(
      createD1ForSqlite(sqlite),
      config,
      new Date("2026-08-10T12:00:00.000Z"),
      fetcher,
    );

    expect(result).toMatchObject({ sent: 1, retryable: 1, authBlocked: 0, failed: 0 });
    expect(sqlite.prepare("SELECT recipient, status FROM notifications ORDER BY recipient").all()).toEqual([
      { recipient: "kimchany@usc.edu", status: "sent" },
      { recipient: "lupeter@usc.edu", status: "retryable" },
    ]);
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
      { recipient: "kimchany@usc.edu", status: "auth_blocked" },
      { recipient: "lupeter@usc.edu", status: "queued" },
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
