import type { CrawledJob } from "./crawler.ts";
import { jobPostingIdentityKeys, type JobPostingIdentityInput } from "./job-posting-identity.ts";

export async function findArchivedJob(database: D1Database, job: JobPostingIdentityInput) {
  const keys = jobPostingIdentityKeys(job);
  return database.prepare(`SELECT job_id FROM expired_job_archive WHERE
    (source_id = ? AND official_url = ?) OR requisition_identity_key = ?
    OR external_identity_key = ? OR url_identity_key = ? LIMIT 1
  `).bind(job.sourceId, job.officialUrl, keys.requisitionIdentityKey, keys.externalIdentityKey, keys.urlIdentityKey).first();
}

export const JOB_RETENTION_DAYS = 30;
export const retentionCutoff = (now: string): string => {
  const time = Date.parse(now);
  if (!Number.isFinite(time)) throw new Error("Invalid retention clock.");
  return new Date(time - JOB_RETENTION_DAYS * 86_400_000).toISOString();
};

// Never use first_seen_at, last_seen_at or source_updated_at as posting dates.
export const isExpiredPosting = (publishedAt: unknown, now: string): boolean => {
  if (typeof publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T| |$)/.test(publishedAt)) return false;
  const normalized = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(publishedAt)
    ? `${publishedAt.replace(" ", "T")}Z` : publishedAt;
  const time = Date.parse(normalized);
  return Number.isFinite(time) && time <= Date.parse(retentionCutoff(now));
};

/** Check a bounded incoming chunk, never load an entire source's archive. */
export async function retainIncomingJobs(database: D1Database, sourceId: string, jobs: CrawledJob[], now: string): Promise<CrawledJob[]> {
  const recent = jobs.filter((job) => !isExpiredPosting(job.publishedAt, now));
  if (!recent.length) return [];
  const identities = recent.map((job, position) => ({
    position, officialUrl: job.officialUrl, ...jobPostingIdentityKeys({ sourceId, ...job }),
  }));
  const excluded = new Set<number>();
  const encoder = new TextEncoder();
  const chunks: typeof identities[] = [];
  let chunk: typeof identities = [];
  let bytes = 2;
  for (const identity of identities) {
    const size = encoder.encode(JSON.stringify(identity)).byteLength + 1;
    if (chunk.length && bytes + size > 1_500_000) { chunks.push(chunk); chunk = []; bytes = 2; }
    chunk.push(identity); bytes += size;
  }
  if (chunk.length) chunks.push(chunk);
  for (const batch of chunks) {
    const archived = await database.prepare(`
    SELECT json_extract(value, '$.position') AS position FROM json_each(?) incoming
    WHERE EXISTS (SELECT 1 FROM expired_job_archive a WHERE a.source_id = ?
      AND a.official_url = json_extract(incoming.value, '$.officialUrl'))
      OR EXISTS (SELECT 1 FROM expired_job_archive a
        WHERE a.requisition_identity_key = json_extract(incoming.value, '$.requisitionIdentityKey'))
      OR EXISTS (SELECT 1 FROM expired_job_archive a
        WHERE a.external_identity_key = json_extract(incoming.value, '$.externalIdentityKey'))
      OR EXISTS (SELECT 1 FROM expired_job_archive a
        WHERE a.url_identity_key = json_extract(incoming.value, '$.urlIdentityKey'))
    `).bind(JSON.stringify(batch), sourceId).all<{ position: number }>();
    for (const row of archived.results) excluded.add(row.position);
  }
  return recent.filter((_, position) => !excluded.has(position));
}

export const expiredJobsPredicate = `julianday(published_at) <= julianday(?)
  AND published_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND substr(published_at, 11, 1) IN ('', 'T', ' ')`;

/** One atomic, idempotent deletion chunk; the owner workflow drains repeatedly. */
export async function purgeExpiredJobs(database: D1Database, now: string, dryRun = false, limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Retention limit must be 1-100.");
  const cutoff = retentionCutoff(now);
  const selected = await database.prepare(`SELECT id FROM jobs
    WHERE ${expiredJobsPredicate} ORDER BY julianday(published_at), id LIMIT ?
  `).bind(cutoff, limit).all<{ id: string }>();
  if (dryRun || !selected.results.length) {
    return { cutoff, dryRun, selected: selected.results.length, deleted: 0, hasMore: selected.results.length > 0 };
  }
  const ids = JSON.stringify(selected.results.map((row) => row.id));
  // Recheck dates inside the transaction: a concurrent refresh between the
  // selection and batch must not delete a newly dated posting.
  const target = `j.id IN (SELECT value FROM json_each(?)) AND ${expiredJobsPredicate.replaceAll("published_at", "j.published_at")}`;
  const results = await database.batch([
    database.prepare(`INSERT INTO expired_job_archive
      (job_id, source_id, official_url, requisition_identity_key, external_identity_key,
       url_identity_key, published_at, archived_at, audit)
      SELECT j.id, j.source_id, j.official_url, j.requisition_identity_key, j.external_identity_key,
        j.url_identity_key, j.published_at, ?, json_object(
          'company', j.company, 'title', j.title, 'location', j.location, 'reviewState', j.review_state,
          'matches', json((SELECT json_group_array(json_object('id', m.id, 'keywordId', m.keyword_id,
            'notifiedAt', m.notified_at, 'openGeneration', m.open_generation)) FROM job_matches m WHERE m.job_id = j.id)),
          'reviews', json((SELECT json_group_array(json_object('id', r.id, 'jobMatchId', r.job_match_id,
            'profileId', r.profile_id, 'decision', r.decision, 'rationale', r.rationale, 'verifiedUrl', r.verified_url,
            'sourceFile', r.source_file, 'reviewer', r.reviewer, 'reviewedAt', r.reviewed_at))
            FROM job_matches m JOIN codex_reviews r ON r.job_match_id = m.id WHERE m.job_id = j.id)),
          'notificationItems', json((SELECT json_group_array(json_object('id', ni.id, 'notificationId', ni.notification_id,
            'jobMatchId', ni.job_match_id, 'recipient', ni.recipient, 'createdAt', ni.created_at))
            FROM job_matches m JOIN notification_items ni ON ni.job_match_id = m.id WHERE m.job_id = j.id)))
      FROM jobs j WHERE ${target}
      ON CONFLICT(job_id) DO UPDATE SET audit = excluded.audit, archived_at = excluded.archived_at
    `).bind(now, ids, cutoff),
    // Backfill legacy delivered identities before cascading job_matches/items.
    database.prepare(`INSERT OR IGNORE INTO notification_identity_history
      (profile_id, recipient, identity_key, first_sent_at, notification_id, job_match_id)
      SELECT mp.id, ni.recipient, CAST(identity.value AS TEXT), COALESCE(n.sent_at, jm.notified_at, ni.created_at), n.id, jm.id
      FROM jobs j JOIN job_matches jm ON jm.job_id = j.id
      JOIN match_profiles mp ON mp.keyword_id = jm.keyword_id
      JOIN notification_items ni ON ni.job_match_id = jm.id
      JOIN notifications n ON n.id = ni.notification_id
      JOIN json_each(json_array(j.requisition_identity_key, j.external_identity_key, j.url_identity_key)) identity
      WHERE ${target} AND n.status = 'sent' AND identity.value IS NOT NULL
    `).bind(ids, cutoff),
    database.prepare(`DELETE FROM jobs AS j WHERE ${target}
      AND EXISTS (SELECT 1 FROM expired_job_archive a WHERE a.job_id = j.id AND a.archived_at = ?)
    `).bind(ids, cutoff, now),
    database.prepare("DELETE FROM job_filter_options_cache"),
  ]);
  const more = await database.prepare(`SELECT id FROM jobs WHERE ${expiredJobsPredicate} LIMIT 1`).bind(cutoff).first();
  return { cutoff, dryRun, selected: selected.results.length, deleted: results[2].meta.changes, hasMore: Boolean(more) };
}
