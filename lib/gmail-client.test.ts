import { describe, expect, it, vi } from "vitest";
import { sendGmailMessage } from "./gmail-client";

const credentials = {
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "refresh",
};
const message = {
  from: "kimchany@usc.edu", to: "lupeter@usc.edu", subject: "Digest", jobs: [], siteUrl: "https://example.com/jobs",
};

describe("Gmail API transport", () => {
  it("exchanges the refresh token and sends as user me", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "gmail-message-1" }), { status: 200 }));

    await expect(sendGmailMessage(credentials, message, fetcher)).resolves.toEqual({ messageId: "gmail-message-1" });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    ]);
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ Authorization: "Bearer access" });
  });

  it.each([
    [401, "auth"],
    [429, "retryable"],
    [503, "retryable"],
    [400, "permanent"],
  ] as const)("classifies Gmail status %s as %s", async (status, kind) => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("provider details", { status }));

    await expect(sendGmailMessage(credentials, message, fetcher)).rejects.toMatchObject({ kind, status });
  });

  it("classifies invalid_grant without persisting provider details", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant", error_description: "sensitive" }), { status: 400 }));

    await expect(sendGmailMessage(credentials, message, fetcher)).rejects.toEqual(expect.objectContaining({
      kind: "auth",
      message: "Gmail authorization is no longer valid.",
    }));
  });
});
