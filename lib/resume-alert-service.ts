import { GmailDeliveryError, sendGmailMessage } from "./gmail-client";
import {
  claimDueNotifications,
  markNotificationFailed,
  markNotificationSent,
  planResumeDigests,
  purgeCoopResumeNotifications,
  releaseClaimedNotifications,
} from "./resume-alert-store";

export interface GmailRuntimeConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  sender: string;
  siteUrl: string;
}

export interface ResumeDispatchResult {
  planned: number;
  sent: number;
  retryable: number;
  authBlocked: number;
  failed: number;
  skipped: boolean;
}

export interface TestEmailResult {
  sent: number;
  failed: number;
  authBlocked: number;
  retryable: number;
  permanent: number;
}

/**
 * The scheduled API action must make delivery failures visible to GitHub
 * Actions. A JSON 200 with an embedded error otherwise makes a green crawl
 * look healthy even though no digest was delivered.
 */
export const resumeAlertHttpStatus = (
  result: ResumeDispatchResult | { error: string },
): number => {
  if ("error" in result) return 502;
  return result.authBlocked > 0 || result.retryable > 0 || result.failed > 0 ? 502 : 200;
};

const emptyResult = (skipped = false): ResumeDispatchResult => ({
  planned: 0, sent: 0, retryable: 0, authBlocked: 0, failed: 0, skipped,
});

export const processDueResumeAlerts = async (
  database: D1Database,
  config: GmailRuntimeConfig | null,
  now: Date,
  fetcher: typeof fetch = fetch,
): Promise<ResumeDispatchResult> => {
  await purgeCoopResumeNotifications(database, "chanyoung-resume");
  if (!config) {
    await database.prepare(`
      UPDATE match_profiles SET gmail_state = 'unconfigured', updated_at = CURRENT_TIMESTAMP
      WHERE id = 'chanyoung-resume' AND gmail_state <> 'blocked'
    `).run();
    return emptyResult(true);
  }
  const nowIso = now.toISOString();
  const planned = await planResumeDigests(database, "chanyoung-resume", nowIso, 25);
  const claimed = await claimDueNotifications(database, "chanyoung-resume", nowIso, 4);
  const result = { ...emptyResult(), planned: planned.length };
  for (const [index, notification] of claimed.entries()) {
    try {
      const sent = await sendGmailMessage({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        refreshToken: config.refreshToken,
      }, {
        from: config.sender,
        to: notification.recipient,
        subject: `[Job Pulse] ${notification.jobCount} new resume match${notification.jobCount === 1 ? "" : "es"}`,
        jobs: notification.jobs,
        siteUrl: config.siteUrl,
      }, fetcher);
      await markNotificationSent(database, notification.id, sent.messageId, nowIso);
      result.sent += 1;
    } catch (error) {
      const delivery = error instanceof GmailDeliveryError
        ? error
        : new GmailDeliveryError("retryable", "Gmail delivery failed unexpectedly.", null);
      await markNotificationFailed(database, notification, delivery.kind, nowIso, delivery.message);
      if (delivery.kind === "auth") {
        result.authBlocked += 1;
        await releaseClaimedNotifications(database, claimed.slice(index + 1).map((item) => item.id), nowIso);
        break;
      }
      else if (delivery.kind === "retryable") result.retryable += 1;
      else result.failed += 1;
    }
  }
  return result;
};

export const sendResumeTestEmail = async (
  config: GmailRuntimeConfig,
  recipients: string[],
  fetcher: typeof fetch = fetch,
): Promise<TestEmailResult> => {
  const result = { sent: 0, failed: 0, authBlocked: 0, retryable: 0, permanent: 0 };
  for (const recipient of recipients) {
    try {
      await sendGmailMessage({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        refreshToken: config.refreshToken,
      }, {
        from: config.sender,
        to: recipient,
        subject: "[Job Pulse] Gmail connection test",
        jobs: [],
        siteUrl: config.siteUrl,
        testOnly: true,
      }, fetcher);
      result.sent += 1;
    } catch (error) {
      result.failed += 1;
      const delivery = error instanceof GmailDeliveryError
        ? error
        : new GmailDeliveryError("retryable", "Gmail delivery failed unexpectedly.", null);
      if (delivery.kind === "auth") {
        result.authBlocked += 1;
        break;
      }
      if (delivery.kind === "retryable") result.retryable += 1;
      else result.permanent += 1;
    }
  }
  return result;
};
