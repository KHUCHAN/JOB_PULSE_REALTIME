import type { DigestJob } from "./gmail-message";
import type { ResumeAlertStatus } from "./domain";
import { canonicalOpenJobNotExists } from "./job-canonical";
import { postingIdentityHistoryMatchSql, postingIdentityOverlapSql } from "./job-posting-identity";
import { jobHasCoopSql } from "./job-program-policy";

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
type PendingMatchRow = { id: string; pending_recipients: string };
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
  program: "Internship" | "Co-op";
  is_summer: number;
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

const pendingRecipients = (value: string, allowed: string[]): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const present = new Set(parsed.filter((item): item is string => typeof item === "string"));
    return allowed.filter((recipient) => present.has(recipient));
  } catch {
    return [];
  }
};

export const planResumeDigests = async (
  database: D1Database,
  profileId: string,
  now: string,
  pageSize = 500,
  maxMessages = 1,
  exactJobIds: string[] | null = null,
): Promise<PlannedNotification[]> => {
  const exactTargetsInput = exactJobIds === null ? null : [...new Set(exactJobIds)];
  if (exactTargetsInput !== null && exactTargetsInput.length > 500) {
    throw new Error("Exact Codex dispatch is limited to 500 job IDs.");
  }
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
    const boundedPageSize = Math.max(1, Math.min(500, Math.trunc(pageSize)));
    const boundedMessageLimit = Math.max(1, Math.min(1, Math.trunc(maxMessages)));
    const exactTargets = exactTargetsInput;
    const enabledRecipients = recipients.results.map((row) => row.recipient);
    if (exactTargets !== null) {
      const encodedTargets = JSON.stringify(exactTargets);
      // An interrupted or failed prior attempt may have reserved some of this
      // exact Codex batch in an unsent envelope. Rebuild only those items so
      // retrying the batch is safe and cannot be blocked by stale reservations.
      const staleNotifications = await database.prepare(`
        SELECT DISTINCT ni.notification_id AS id
        FROM json_each(?) target
        JOIN job_matches jm ON jm.job_id = CAST(target.value AS TEXT) AND jm.keyword_id = ?
        JOIN notification_items ni ON ni.job_match_id = jm.id
        JOIN notifications n ON n.id = ni.notification_id
        WHERE n.status <> 'sent'
          AND (n.status <> 'sending' OR n.lease_expires_at IS NULL OR n.lease_expires_at <= ?)
      `).bind(encodedTargets, keywordId, now).all<{ id: string }>();
      const staleNotificationIds = staleNotifications.results.map((row) => row.id);
      if (staleNotificationIds.length > 0) {
        const encodedNotifications = JSON.stringify(staleNotificationIds);
        await database.batch([
          database.prepare(`
            DELETE FROM notification_items
            WHERE notification_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
              AND job_match_id IN (
                SELECT jm.id FROM job_matches jm
                WHERE jm.keyword_id = ?
                  AND jm.job_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
              )
          `).bind(encodedNotifications, keywordId, encodedTargets),
          database.prepare(`
            UPDATE notifications
            SET job_count = (
              SELECT count(DISTINCT ni.job_match_id)
              FROM notification_items ni WHERE ni.notification_id = notifications.id
            )
            WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
          `).bind(encodedNotifications),
          database.prepare(`
            DELETE FROM notifications
            WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
              AND NOT EXISTS (
                SELECT 1 FROM notification_items ni WHERE ni.notification_id = notifications.id
              )
          `).bind(encodedNotifications),
        ]);
      }
    }
    // Normal planning must compare every pending match against the full open
    // catalog. An exact Codex dispatch already supplies a bounded, deduplicated
    // identity set, so compare contenders only inside that set. Re-running the
    // full better-match scan once per exact target can exceed D1's CPU limit
    // before Gmail is reached on a large production catalog.
    if (exactTargets !== null) {
      const duplicateIdentity = await database.prepare(`
        WITH exact_jobs AS MATERIALIZED (
          SELECT j.id, j.requisition_identity_key, j.external_identity_key, j.url_identity_key
          FROM json_each(?) target
          JOIN jobs j ON j.id = CAST(target.value AS TEXT)
        )
        SELECT 1 AS duplicate
        FROM exact_jobs left_job
        JOIN exact_jobs right_job ON right_job.id > left_job.id
          AND ${postingIdentityOverlapSql("left_job", "right_job")}
        LIMIT 1
      `).bind(JSON.stringify(exactTargets)).first<{ duplicate: number }>();
      if (duplicateIdentity) {
        throw new Error("Exact Codex dispatch contains overlapping posting identities.");
      }
    }
    const matches = exactTargets === null
      ? await database.prepare(`
      SELECT jm.id, json_group_array(pr.recipient) AS pending_recipients
      FROM job_matches jm
      JOIN jobs j ON j.id = jm.job_id
      JOIN profile_recipients pr ON pr.profile_id = ? AND pr.enabled = 1
      LEFT JOIN notification_items ni
        ON ni.job_match_id = jm.id AND ni.recipient = pr.recipient
      WHERE jm.keyword_id = ? AND jm.is_active = 1 AND jm.notification_eligible = 1
        AND jm.open_generation = j.open_generation AND j.status = 'open'
        AND ${canonicalOpenJobNotExists("j")}
        AND ni.id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM notification_identity_history history
          WHERE history.profile_id = ? AND history.recipient = pr.recipient
            AND ${postingIdentityHistoryMatchSql("j", "history")}
        )
        AND NOT EXISTS (
          SELECT 1
          FROM job_matches better_match
          JOIN jobs better_job ON better_job.id = better_match.job_id
          WHERE better_match.keyword_id = jm.keyword_id
            AND better_match.is_active = 1 AND better_match.notification_eligible = 1
            AND better_match.open_generation = better_job.open_generation
            AND better_job.status = 'open'
            AND ${postingIdentityOverlapSql("j", "better_job")}
            AND (
              better_match.score > jm.score
              OR (better_match.score = jm.score
                AND COALESCE(better_job.published_at, better_job.first_seen_at)
                  > COALESCE(j.published_at, j.first_seen_at))
              OR (better_match.score = jm.score
                AND COALESCE(better_job.published_at, better_job.first_seen_at)
                  = COALESCE(j.published_at, j.first_seen_at)
                AND better_match.id < jm.id)
            )
        )
      GROUP BY jm.id, jm.score, j.published_at, j.first_seen_at
      ORDER BY jm.score DESC, COALESCE(j.published_at, j.first_seen_at) DESC, jm.id
      LIMIT ?
    `).bind(
      profileId,
      keywordId,
      profileId,
      boundedPageSize * boundedMessageLimit + 1,
    ).all<PendingMatchRow>()
      : await database.prepare(`
      WITH exact_jobs(id) AS MATERIALIZED (
        SELECT CAST(value AS TEXT) FROM json_each(?)
      )
      SELECT jm.id, json_group_array(pr.recipient) AS pending_recipients
      FROM exact_jobs target
      JOIN jobs j ON j.id = target.id
      JOIN job_matches jm ON jm.job_id = j.id AND jm.keyword_id = ?
      JOIN codex_reviews review
        ON review.job_match_id = jm.id
       AND review.profile_id = ?
       AND review.decision = 'approve'
      JOIN profile_recipients pr ON pr.profile_id = ? AND pr.enabled = 1
      LEFT JOIN notification_items ni
        ON ni.job_match_id = jm.id AND ni.recipient = pr.recipient
      WHERE jm.is_active = 1
        AND jm.open_generation = j.open_generation AND j.status = 'open'
        AND ${canonicalOpenJobNotExists("j")}
        AND ni.id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM notification_identity_history history
          WHERE history.profile_id = ? AND history.recipient = pr.recipient
            AND ${postingIdentityHistoryMatchSql("j", "history")}
        )
      GROUP BY jm.id, jm.score, j.published_at, j.first_seen_at
      ORDER BY jm.score DESC, COALESCE(j.published_at, j.first_seen_at) DESC, jm.id
      LIMIT ?
    `).bind(
      JSON.stringify(exactTargets),
      keywordId,
      profileId,
      profileId,
      profileId,
      boundedPageSize * boundedMessageLimit + 1,
    ).all<PendingMatchRow>();

    // Exact Codex dispatches are all-or-nothing. A missing, already reserved,
    // superseded, or previously delivered identity must fail before an email
    // envelope is created rather than silently sending a partial batch.
    if (exactTargets !== null && matches.results.length !== exactTargets.length) {
      throw new Error(`Exact Codex dispatch target mismatch: requested ${exactTargets.length}, eligible ${matches.results.length}.`);
    }

    // A normal digest has the exact same pending recipient set for every job,
    // so all recipients share one MIME message. If a prior partial delivery
    // left only one recipient pending, keep that subset separate to avoid
    // sending a duplicate job to a recipient who already received it.
    const groups = new Map<string, { recipients: string[]; matches: string[] }>();
    for (const match of matches.results) {
      const groupRecipients = pendingRecipients(match.pending_recipients, enabledRecipients);
      if (groupRecipients.length === 0) continue;
      const key = groupRecipients.join("\u001f");
      const group = groups.get(key) ?? { recipients: groupRecipients, matches: [] };
      group.matches.push(match.id);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      const remainingMessageSlots = boundedMessageLimit - planned.length;
      if (remainingMessageSlots <= 0) {
        hasRemaining = true;
        break;
      }
      const capacity = boundedPageSize * remainingMessageSlots;
      const selected = group.matches.slice(0, capacity);
      if (selected.length < group.matches.length) hasRemaining = true;
      for (let index = 0; index < selected.length; index += boundedPageSize) {
        const part = selected.slice(index, index + boundedPageSize);
        const notificationId = crypto.randomUUID();
        const recipientHeader = group.recipients.join(", ");
        const items = part.flatMap((jobMatchId) => group.recipients.map((recipient) => ({
          id: crypto.randomUUID(), notificationId, jobMatchId, recipient,
        })));
        await database.batch([
          database.prepare(`
            INSERT INTO notifications (
              id, keyword_id, channel, recipient, status, job_count, scheduled_at,
              attempt_count, created_at
            ) VALUES (?, ?, 'email', ?, 'queued', ?, ?, 0, ?)
          `).bind(notificationId, keywordId, recipientHeader, part.length, now, now),
          database.prepare(`
            INSERT OR IGNORE INTO notification_items (id, notification_id, job_match_id, recipient)
            SELECT json_extract(value, '$.id'), json_extract(value, '$.notificationId'),
                   json_extract(value, '$.jobMatchId'), json_extract(value, '$.recipient')
            FROM json_each(?)
          `).bind(JSON.stringify(items)),
          database.prepare(`
            UPDATE notifications
            SET job_count = (SELECT count(DISTINCT job_match_id) FROM notification_items WHERE notification_id = ?)
            WHERE id = ?
          `).bind(notificationId, notificationId),
          database.prepare(`
            DELETE FROM notifications
            WHERE id = ? AND NOT EXISTS (
              SELECT 1 FROM notification_items WHERE notification_id = ?
            )
          `).bind(notificationId, notificationId),
        ]);
        planned.push({ id: notificationId, recipient: recipientHeader, jobCount: part.length });
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
  exactNotificationIds: string[] | null = null,
): Promise<ClaimedNotification[]> => {
  const owner = crypto.randomUUID();
  const exactIds = exactNotificationIds === null ? null : [...new Set(exactNotificationIds)].slice(0, 4);
  const claimed = await database.prepare(`
    UPDATE notifications
    SET status = 'sending', lease_owner = ?, lease_expires_at = ?,
        attempt_count = attempt_count + 1, error = NULL
    WHERE id IN (
      SELECT n.id FROM notifications n
      JOIN match_profiles mp ON mp.keyword_id = n.keyword_id
      WHERE n.channel = 'email' AND mp.id = ? AND mp.enabled = 1 AND mp.gmail_state = 'connected'
        AND (? IS NULL OR n.id IN (SELECT CAST(value AS TEXT) FROM json_each(?)))
        AND (status = 'queued' OR (status = 'retryable' AND next_retry_at <= ?)
          OR (status = 'sending' AND lease_expires_at <= ?))
      ORDER BY scheduled_at, n.id
      LIMIT ?
    )
    RETURNING id, recipient, job_count, attempt_count
  `).bind(
    owner,
    plusMinutes(now, 5),
    profileId,
    exactIds === null ? null : JSON.stringify(exactIds),
    exactIds === null ? null : JSON.stringify(exactIds),
    now,
    now,
    Math.max(1, Math.min(4, limit)),
  ).all<ClaimedRow>();
  if (claimed.results.length === 0) return [];
  const ids = claimed.results.map((row) => row.id);
  const jobs = await database.prepare(`
    SELECT DISTINCT ni.notification_id, j.company, j.title, j.location, j.official_url,
           j.published_at, j.first_seen_at, jm.score, jm.matched_terms,
           CASE WHEN ${jobHasCoopSql("j")} THEN 'Co-op' ELSE 'Internship' END AS program,
           EXISTS (
             SELECT 1 FROM job_topics summer_topic
             WHERE summer_topic.job_id = j.id AND summer_topic.topic_key = 'season:summer'
           ) AS is_summer
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
      program: row.program,
      scheduleNote: row.program === "Co-op"
        ? row.is_summer === 1
          ? "Summer work term"
          : "Work-term dates not stated; verify possible semester overlap"
        : null,
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
  await database.batch([
    database.prepare(`
      UPDATE notifications
      SET status = 'sent', provider_message_id = ?, sent_at = ?, error = NULL,
          lease_owner = NULL, lease_expires_at = NULL, next_retry_at = NULL
      WHERE id = ? AND status = 'sending'
    `).bind(providerMessageId, now, notificationId),
    database.prepare(`
      INSERT OR IGNORE INTO notification_identity_history (
        profile_id, recipient, identity_key, first_sent_at, notification_id, job_match_id
      )
      SELECT mp.id, ni.recipient, CAST(identity.value AS TEXT), ?, ni.notification_id, jm.id
      FROM notification_items ni
      JOIN job_matches jm ON jm.id = ni.job_match_id
      JOIN jobs j ON j.id = jm.job_id
      JOIN match_profiles mp ON mp.keyword_id = jm.keyword_id
      JOIN json_each(json_array(
        j.requisition_identity_key, j.external_identity_key, j.url_identity_key
      )) identity
      WHERE ni.notification_id = ? AND identity.value IS NOT NULL
    `).bind(now, notificationId),
    database.prepare(`
      UPDATE match_profiles SET last_digest_at = ?, last_error = NULL, gmail_state = 'connected', updated_at = CURRENT_TIMESTAMP
      WHERE keyword_id = (SELECT keyword_id FROM notifications WHERE id = ?)
    `).bind(now, notificationId),
    database.prepare(`
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
    `).bind(now, notificationId),
  ]);
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
    JOIN jobs j ON j.id = jm.job_id
    WHERE mp.id = ? AND jm.is_active = 1 AND jm.notification_eligible = 1
      AND jm.open_generation = j.open_generation AND j.status = 'open'
      AND ${canonicalOpenJobNotExists("j")}
      AND EXISTS (
        SELECT 1 FROM profile_recipients pr WHERE pr.profile_id = mp.id AND pr.enabled = 1
          AND NOT EXISTS (SELECT 1 FROM notification_items ni WHERE ni.job_match_id = jm.id AND ni.recipient = pr.recipient)
          AND NOT EXISTS (
            SELECT 1 FROM notification_identity_history history
            WHERE history.profile_id = mp.id AND history.recipient = pr.recipient
              AND ${postingIdentityHistoryMatchSql("j", "history")}
          )
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
