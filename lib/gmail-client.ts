import { buildGmailRawMessage, type GmailMessageInput } from "./gmail-message";

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export class GmailDeliveryError extends Error {
  constructor(
    readonly kind: "auth" | "retryable" | "permanent",
    message: string,
    readonly status: number | null,
  ) {
    super(message.slice(0, 500));
    this.name = "GmailDeliveryError";
  }
}

const failureKind = (status: number): GmailDeliveryError["kind"] => status === 401 || status === 403
  ? "auth"
  : status === 408 || status === 429 || status >= 500
    ? "retryable"
    : "permanent";

const request = async (
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } catch {
    throw new GmailDeliveryError("retryable", "Gmail could not be reached.", null);
  } finally {
    clearTimeout(timeout);
  }
};

export const sendGmailMessage = async (
  credentials: GmailCredentials,
  message: GmailMessageInput,
  fetcher: typeof fetch = fetch,
): Promise<{ messageId: string }> => {
  const tokenResponse = await request(fetcher, "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  let tokenJson: { access_token?: unknown; error?: unknown } = {};
  try { tokenJson = await tokenResponse.json() as typeof tokenJson; } catch { /* classified below */ }
  if (!tokenResponse.ok || typeof tokenJson.access_token !== "string") {
    if (tokenJson.error === "invalid_grant" || tokenResponse.status === 401) {
      throw new GmailDeliveryError("auth", "Gmail authorization is no longer valid.", tokenResponse.status);
    }
    throw new GmailDeliveryError(
      failureKind(tokenResponse.status),
      tokenResponse.status >= 500 ? "Gmail authorization is temporarily unavailable." : "Gmail authorization failed.",
      tokenResponse.status,
    );
  }

  const sendResponse = await request(fetcher, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenJson.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: buildGmailRawMessage(message) }),
  });
  let sendJson: { id?: unknown } = {};
  try { sendJson = await sendResponse.json() as typeof sendJson; } catch { /* classified below */ }
  if (!sendResponse.ok || typeof sendJson.id !== "string") {
    throw new GmailDeliveryError(
      failureKind(sendResponse.status),
      sendResponse.status >= 500 || sendResponse.status === 429
        ? "Gmail delivery is temporarily unavailable."
        : sendResponse.status === 401 || sendResponse.status === 403
          ? "Gmail authorization is no longer valid."
          : "Gmail rejected the message.",
      sendResponse.status,
    );
  }
  return { messageId: sendJson.id };
};
