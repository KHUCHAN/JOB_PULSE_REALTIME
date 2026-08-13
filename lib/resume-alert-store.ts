import type { DigestJob } from "./gmail-message";
import type { ResumeAlertStatus } from "./domain";
import { canonicalOpenJobNotExists } from "./job-canonical";

export interface PlannedNotification {
  id: string;
  recipient: string;
  jobCount: number;
}

export interface ClaimedNotification extends PlannedNotification {
  attemptCount: number;
  jobs: DigestJob[];
}

type LeaseRow = { keyword_id: string };
type RecipientRow = { recipient: string };
type MatchRow = { id: string };
type ClaimedRow = { id: string; recipient: string; job_count: number; attempt_count: number };
type DigestRow = {
  notification_id: string;
  company: string;
  title: string;
  location: string | null;
  official_url: string;
  published_at: string | null;
  first_seen_at: string;
  score: number;
  matched_terms: string;
};

const plusMinutes = (value: string, minutes: number): string => new Date(
  new Date(value).getTime() + minutes * 60_000,
).toISOString();

const evidenceLabels = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string")
      .map((item) => item.split("|")[1] || item).slice(0, 4) : [];
  } catch {
    return [];
  }
};

export const planResumeDigests = async (
  database: D1Database,
  profileId: string,
  now: string,
  pageSize = 25,
  maxMessages = 4,
): Promise<PlannedNotification[]> => {
  const owner = crypto.randomUUID();
  const leaseUntil = plusMinutes(now, 5);
  // The scheduled crawl performs alert planning immediately after persistence.
  // Allow a short scheduler boundary window so a digest that becomes due while
  // the crawl is finishing is not skipped until the next two-hour run. This
  // only affects eligibility; all timestamps written below still use `now`.
  const dueNow = plusMinutes(now, 1);
  const lease = await database.prepare(`
    UPDATE match_profiles
    SET dispatch_lease_owner = ?, dispatch_lease_expires_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND enabled = 1
      AND gmail_state = 'connected'
      AND (next_digest_at IS NULL OR next_digest_at <= ?)
      AND (dispatch_lease_expires_at IS NULL OR dispatch_lease_expires_at <= ?)
    RETURNING keyword_id
  `).bind(owner, leaseUntil, profileId, dueNow, now).all<LeaseRow>();
  const keywordId = lease.results[0]?.keyword_id;
  if (!keywordId) return [];

  const planned: PlannedNotification[] = [];
  let completed = false;
  let hasRemaining = false;
  try {
    const recipients = await database.prepare(`
      SELECT recipient FROM profile_recipients
      WHERE profile_id = ? AND enabled = 1
      ORDER BY recipient
    `).bind(profileId).all<RecipientRow>();
    const boundedPageSize = Math.max(1, Math.min(25, Math.trunc(pageSize)));
    const boundedMessageLimit = Math.max(1, Math.min(4, Math.trunc(maxMessages)));
    for (const [recipientIndex, { recipient }] of recipients.results.entries()) {
      const remainingMessageSlots = boundedMessageLimit - planned.length;
      if (remainingMessageSlots <= 0) {
        hasRemaining = true;
        break;
      }
      const remainingRecipients = recipients.results.length - recipientIndex;
      const fairMessageSlots = Math.max(1, Math.floor(remainingMessageSlots / remainingRecipients));
      const matches = await database.prepare(`
        SELECT jm.id
        FROM job_matches jm
        JOIN jobs j ON j.id = jm.job_id
        WHERE jm.keyword_id = ? AND jm.is_active = 1 AND jm.notification_eligible = 1
          AND jm.open_generation = j.open_generation AND j.status = 'open'
          AND ${canonicalOpenJobNotExists("j")}
          AND NOT EXISTS (
            SELECT 1 FROM notification_items ni
            WHERE ni.job_match_id = jm.id AND ni.recipient = ?
          )
        ORDER BY jm.score DESC, COALESCE(j.published_at, j.first_seen_at) DESC, jm.id
        LIMIT ?
      `).bind(keywordId, recipient, boundedPageSize * fairMessageSlots + 1).all<MatchRow>();
      if (matches.results.length === 0) continue;
      const selected = matches.results.slice(0, boundedPageSize * fairMessageSlots);
      if (matches.results.length > selected.length) hasRemaining = true;
      for (let index = 0; index < selected.length; index += boundedPageSize) {
        const part = selected.slice(index, index + boundedPageSize);
        const notificationId = crypto.randomUUID();
        const items = part.map((match) => ({
          id: crypto.randomUUID(), notificationId, jobMatchId: match.id, recipient,
        }));
        await database.batch([
          database.prepare(`
            INSERT INTO notifications (
              id, keyword_id, channel, recipient, status, job_count, scheduled_at,
              attempt_count, created_at
            ) VALUES (?, ?, 'email', ?, 'queued', ?, ?, 0, ?)
          `).bind(notificationId, keywordId, recipient, part.length, now, now),
          database.prepare(`
            INSERT OR IGNORE INTO notification_items (id, notification_id, job_match_id, recipient)
            SELECT json_extract(value, '$.id'), json_extract(value, '$.notificationId'),
                   json_extract(value, '$.jobMatchId'), json_extract(value, '$.recipient')
            FROM json_each(?)
          `).bind(JSON.stringify(items)),
          database.prepare(`
            UPDATE notifications
            SET job_count = (SELECT count(*) FROM notification_items WHERE notification_id = ?)
            WHERE id = ?
          `).bind(notificationId, notificationId),
          database.prepare(`
            DELETE FROM notifications
            WHERE id = ? AND NOT EXISTS (
              SELECT 1 FROM notification_items WHERE notification_id = ?
            )
          `).bind(notificationId, notificationId),
        ]);
        planned.push({ id: notificationId, recipient, jobCount: part.length });
      }
      if (planned.length >= boundedMessageLimit && recipientIndex < recipients.results.length - 1) {
        hasRemaining = true;
      }
    }
    completed = true;
    return planned;
  } finally {
    await database.prepare(`
      UPDATE match_profiles
      SET dispatch_lease_owner = NULL, dispatch_lease_expires_at = NULL,
          next_digest_at = CASE WHEN ? = 1 THEN ? ELSE next_digest_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND dispatch_lease_owner = ?
    `).bind(Number(completed), hasRemaining ? now : plusMinutes(now, 120), profileId, owner).run();
  }
};

export const claimDueNotifications = async (
  database: D1Database,
  profileId: string,
  now: string,
  limit = 4,
): Promise<ClaimedNotification[]> => {
  const owner = crypto.randomUUID();
  const claimed = await database.prepare(`
    UPDATE notifications
    SET status = 'sending', lease_owner = ?, lease_expires_at = ?,
        attempt_count = attempt_count + 1, error = NULL
    WHERE id IN (
      SELECT n.id FROM notifications n
      JOIN match_profiles mp ON mp.keyword_id = n.keyword_id
      WHERE n.channel = 'email' AND mp.id = ? AND mp.enabled = 1 AND mp.gmail_state = 'connected'
        AND (status = 'queued' OR (status = 'retryable' AND next_retry_at <= ?)
          OR (status = 'sending' AND lease_expires_at <= ?))
      ORDER BY scheduled_at, n.id
      LIMIT ?
    )
    RETURNING id, recipient, job_count, attempt_count
  `).bind(owner, plusMinutes(now, 5), profileId, now, now, Math.max(1, Math.min(4, limit))).all<ClaimedRow>();
  if (claimed.results.length === 0) return [];
  const ids = claimed.results.map((row) => row.id);
  const jobs = await database.prepare(`
    SELECT ni.notification_id, j.company, j.title, j.location, j.official_url,
           j.published_at, j.first_seen_at, jm.score, jm.matched_terms
    FROM notification_items ni
    JOIN job_matches jm ON jm.id = ni.job_match_id
    JOIN jobs j ON j.id = jm.job_id
    WHERE ni.notification_id IN (SELECT value FROM json_each(?))
    ORDER BY ni.notification_id, jm.score DESC, j.company, j.title
  `).bind(JSON.stringify(ids)).all<DigestRow>();
  const grouped = new Map<string, DigestJob[]>();
  for (const row of jobs.results) {
    const list = grouped.get(row.notification_id) ?? [];
    list.push({
      company: row.company,
      title: row.title,
      location: row.location || "Location not specified",
      timing: row.published_at ? `Posted ${row.published_at.slice(0, 10)}` : `First seen ${row.first_seen_at.slice(0, 10)}`,
      score: row.score,
      reasons: evidenceLabels(row.matched_terms),
      officialUrl: row.official_url,
    });
    grouped.set(row.notification_id, list);
  }
  return claimed.results.map((row) => ({
    id: row.id,
    recipient: row.recipient,
    jobCount: row.job_count,
    attemptCount: row.attempt_count,
    jobs: grouped.get(row.id) ?? [],
  }));
};

export const releaseClaimedNotifications = async (
  database: D1Database,
  notificationIds: string[],
  now: string,
): Promise<void> => {
  if (notificationIds.length === 0) return;
  await database.prepare(`
    UPDATE notifications
    SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
        next_retry_at = ?, error = NULL,
        attempt_count = CASE WHEN attempt_count > 0 THEN attempt_count - 1 ELSE 0 END
    WHERE status = 'sending' AND id IN (SELECT value FROM json_each(?))
  `).bind(now, JSON.stringify(notificationIds)).run();
};

export const markNotificationSent = async (
  database: D1Database,
  notificationId: string,
  providerMessageId: string,
  now: string,
): Promise<void> => {
  await database.prepare(`
    UPDATE notifications
    SET status = 'sent', provider_message_id = ?, sent_at = ?, error = NULL,
        lease_owner = NULL, lease_expires_at = NULL, next_retry_at = NULL
    WHERE id = ? AND status = 'sending'
  `).bind(providerMessageId, now, notificationId).run();
  await database.prepare(`
    UPDATE match_profiles SET last_digest_at = ?, last_error = NULL, gmail_state = 'connected', updated_at = CURRENT_TIMESTAMP
    WHERE keyword_id = (SELECT keyword_id FROM notifications WHERE id = ?)
  `).bind(now, notificationId).run();
  await database.prepare(`
    UPDATE job_matches
    SET notified_at = ?
    WHERE id IN (SELECT job_match_id FROM notification_items WHERE notification_id = ?)
      AND NOT EXISTS (
        SELECT 1 FROM profile_recipients pr
        JOIN match_profiles mp ON mp.id = pr.profile_id
        WHERE mp.keyword_id = job_matches.keyword_id AND pr.enabled = 1
          AND NOT EXISTS (
            SELECT 1 FROM notification_items all_items
            JOIN notifications sent_notification ON sent_notification.id = all_items.notification_id
            WHERE all_items.job_match_id = job_matches.id
              AND all_items.recipient = pr.recipient AND sent_notification.status = 'sent'
          )
      )
  `).bind(now, notificationId).run();
};

export const markNotificationFailed = async (
  database: D1Database,
  notification: Pick<ClaimedNotification, "id" | "attemptCount">,
  kind: "auth" | "retryable" | "permanent",
  now: string,
  message: string,
): Promise<void> => {
  const status = kind === "auth" ? "auth_blocked" : kind === "retryable" ? "retryable" : "failed";
  const delays = [5, 15, 60, 360];
  const retryAt = kind === "retryable" ? plusMinutes(now, delays[Math.min(notification.attemptCount - 1, 3)]) : null;
  await database.prepare(`
    UPDATE notifications
    SET status = ?, error = ?, next_retry_at = ?, lease_owner = NULL, lease_expires_at = NULL
    WHERE id = ?
  `).bind(status, message.slice(0, 500), retryAt, notification.id).run();
  await database.prepare(`
    UPDATE match_profiles
    SET gmail_state = CASE WHEN ? = 'auth' THEN 'blocked' ELSE gmail_state END,
        last_error = ?, updated_at = CURRENT_TIMESTAMP
    WHERE keyword_id = (SELECT keyword_id FROM notifications WHERE id = ?)
  `).bind(kind, message.slice(0, 500), notification.id).run();
};

export const clearResumeAlertBacklog = async (
  database: D1Database,
  profileId: "chanyoung-resume",
): Promise<void> => {
  await database.batch([
    database.prepare(`
      DELETE FROM notification_items
      WHERE notification_id IN (
        SELECT id FROM notifications
        WHERE keyword_id = (SELECT keyword_id FROM match_profiles WHERE id = ?)
          AND status <> 'sent'
      )
    `).bind(profileId),
    database.prepare(`
      DELETE FROM notifications
      WHERE keyword_id = (SELECT keyword_id FROM match_profiles WHERE id = ?)
        AND status <> 'sent'
    `).bind(profileId),
    database.prepare(`
      UPDATE job_matches
      SET notification_eligible = 0
      WHERE keyword_id = (SELECT keyword_id FROM match_profiles WHERE id = ?)
        AND notified_at IS NULL
    `).bind(profileId),
  ]);
};

export const getResumeAlertStatus = async (
  database: D1Database,
  profileId: "chanyoung-resume",
  configured: boolean,
  sender = "",
): Promise<ResumeAlertStatus> => {
  const profile = await database.prepare(`
    SELECT enabled, gmail_state, last_digest_at, next_digest_at, last_error
    FROM match_profiles WHERE id = ?
  `).bind(profileId).first<{
    enabled: number; gmail_state: ResumeAlertStatus["gmailState"]; last_digest_at: string | null;
    next_digest_at: string | null; last_error: string | null;
  }>();
  if (!profile) throw new Error("Resume alert profile is missing.");
  const recipients = await database.prepare(`
    SELECT recipient FROM profile_recipients WHERE profile_id = ? AND enabled = 1 ORDER BY recipient
  `).bind(profileId).all<RecipientRow>();
  const queued = await database.prepare(`
    SELECT count(DISTINCT jm.id) AS total
    FROM job_matches jm
    JOIN match_profiles mp ON mp.keyword_id = jm.keyword_id
    WHERE mp.id = ? AND jm.is_active = 1 AND jm.notification_eligible = 1
      AND EXISTS (
        SELECT 1 FROM profile_recipients pr WHERE pr.profile_id = mp.id AND pr.enabled = 1
          AND NOT EXISTS (SELECT 1 FROM notification_items ni WHERE ni.job_match_id = jm.id AND ni.recipient = pr.recipient)
      )
  `).bind(profileId).first<{ total: number }>();
  return {
    profileId,
    enabled: profile.enabled === 1,
    gmailState: configured ? profile.gmail_state === "blocked" ? "blocked" : "connected" : "unconfigured",
    sender,
    recipients: recipients.results.map((row) => row.recipient),
    queuedJobs: queued?.total ?? 0,
    lastDigestAt: profile.last_digest_at,
    nextDigestAt: profile.next_digest_at,
    lastError: profile.last_error,
  };
};

export const setResumeAlertEnabled = async (
  database: D1Database,
  enabled: boolean,
  now: string,
): Promise<void> => {
  await database.prepare(`
    UPDATE match_profiles
    SET enabled = ?, gmail_state = CASE WHEN ? = 1 THEN 'connected' ELSE gmail_state END,
        activation_watermark = CASE WHEN ? = 1 THEN COALESCE(activation_watermark, ?) ELSE activation_watermark END,
        next_digest_at = CASE WHEN ? = 1 THEN COALESCE(next_digest_at, ?) ELSE next_digest_at END,
        last_error = CASE WHEN ? = 1 THEN NULL ELSE last_error END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 'chanyoung-resume'
  `).bind(Number(enabled), Number(enabled), Number(enabled), now, Number(enabled), plusMinutes(now, 120), Number(enabled)).run();
};

export const retryResumeAlerts = async (database: D1Database, now: string): Promise<void> => {
  await database.prepare(`
    UPDATE notifications SET status = 'retryable', next_retry_at = ?, error = NULL
    WHERE status IN ('auth_blocked', 'failed') AND channel = 'email'
      AND keyword_id = (SELECT keyword_id FROM match_profiles WHERE id = 'chanyoung-resume')
  `).bind(now).run();
  await database.prepare(`
    UPDATE match_profiles SET gmail_state = 'connected', last_error = NULL, next_digest_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 'chanyoung-resume'
  `).bind(now).run();
};
