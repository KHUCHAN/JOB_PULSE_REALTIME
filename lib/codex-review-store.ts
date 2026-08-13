import { canonicalOpenJobNotExists } from "./job-canonical";

export type CodexReviewDecision = "approve" | "reject";

export interface CodexReviewInput {
  jobId?: string;
  officialUrl?: string;
  decision: CodexReviewDecision;
  rationale: string;
  verifiedUrl: string;
  sourceFile?: string;
}

export interface CodexReviewResult {
  accepted: number;
  approved: number;
  rejected: number;
  missing: Array<{ jobId?: string; officialUrl?: string; reason: string }>;
}

type ReviewTargetRow = {
  job_match_id: string;
  job_id: string;
  official_url: string;
  apply_url: string | null;
  first_seen_at: string;
  reopened_at: string | null;
  activation_watermark: string | null;
};

const boundedText = (value: unknown, max: number): string => (
  typeof value === "string"
    ? [...value].filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    }).join("").trim().slice(0, max)
    : ""
);

const safeUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
};

const isNewSinceActivation = (row: ReviewTargetRow): boolean => {
  if (!row.activation_watermark) return true;
  return row.first_seen_at > row.activation_watermark
    || (row.reopened_at !== null && row.reopened_at > row.activation_watermark);
};

const targetFor = async (
  database: D1Database,
  input: CodexReviewInput,
): Promise<ReviewTargetRow | null> => {
  const jobId = boundedText(input.jobId, 200);
  const officialUrl = boundedText(input.officialUrl, 2_000);
  if (!jobId && !officialUrl) return null;
  return database.prepare(`
    SELECT jm.id AS job_match_id, j.id AS job_id, j.official_url, j.apply_url,
           j.first_seen_at, j.reopened_at, mp.activation_watermark
    FROM job_matches jm
    JOIN jobs j ON j.id = jm.job_id
    JOIN match_profiles mp ON mp.keyword_id = jm.keyword_id
    WHERE mp.id = 'chanyoung-resume'
      AND jm.is_active = 1 AND jm.open_generation = j.open_generation AND j.status = 'open'
      AND ${canonicalOpenJobNotExists("j")}
      AND EXISTS (
        SELECT 1 FROM job_topics jt
        WHERE jt.job_id = j.id AND jt.topic_key IN ('program:internship', 'program:coop')
      )
      -- Region, recruiting year, and profile fit are Codex review decisions.
      -- The server only admits the crawler's internship/co-op candidate set.
      AND (j.id = ? OR j.official_url = ?)
    LIMIT 1
  `).bind(jobId || null, officialUrl || null).first<ReviewTargetRow>();
};

const normalizedDecision = (value: unknown): CodexReviewDecision | null => (
  value === "approve" || value === "reject" ? value : null
);

export const applyCodexReviews = async (
  database: D1Database,
  values: CodexReviewInput[],
  now = new Date().toISOString(),
): Promise<CodexReviewResult> => {
  const result: CodexReviewResult = { accepted: 0, approved: 0, rejected: 0, missing: [] };
  const boundedValues = values.slice(0, 100);
  for (const raw of boundedValues) {
    const decision = normalizedDecision(raw.decision);
    const rationale = boundedText(raw.rationale, 2_000);
    const verifiedUrl = safeUrl(boundedText(raw.verifiedUrl, 2_000));
    const sourceFile = boundedText(raw.sourceFile, 500) || null;
    if (!decision || !rationale || !verifiedUrl) {
      result.missing.push({ jobId: boundedText(raw.jobId, 200) || undefined, officialUrl: boundedText(raw.officialUrl, 2_000) || undefined, reason: "invalid_review_payload" });
      continue;
    }
    const target = await targetFor(database, raw);
    if (!target) {
      result.missing.push({ jobId: boundedText(raw.jobId, 200) || undefined, officialUrl: boundedText(raw.officialUrl, 2_000) || undefined, reason: "job_match_not_found" });
      continue;
    }
    if (!isNewSinceActivation(target)) {
      result.missing.push({ jobId: target.job_id, officialUrl: target.official_url, reason: "job_is_before_activation_watermark" });
      continue;
    }
    if (verifiedUrl !== target.official_url && verifiedUrl !== target.apply_url) {
      result.missing.push({ jobId: target.job_id, officialUrl: target.official_url, reason: "verified_url_does_not_match_official_url" });
      continue;
    }
    const reviewId = crypto.randomUUID();
    await database.batch([
      database.prepare(`
        INSERT INTO codex_reviews (
          id, job_match_id, profile_id, decision, rationale, verified_url,
          source_file, reviewer, reviewed_at, created_at, updated_at
        ) VALUES (?, ?, 'chanyoung-resume', ?, ?, ?, ?, 'codex', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(job_match_id) DO UPDATE SET
          decision = excluded.decision,
          rationale = excluded.rationale,
          verified_url = excluded.verified_url,
          source_file = excluded.source_file,
          reviewer = excluded.reviewer,
          reviewed_at = excluded.reviewed_at,
          updated_at = CURRENT_TIMESTAMP
      `).bind(reviewId, target.job_match_id, decision, rationale, verifiedUrl, sourceFile, now),
      database.prepare(`
        UPDATE job_matches
        SET notification_eligible = ?, is_active = 1
        WHERE id = ? AND is_active = 1
      `).bind(decision === "approve" ? 1 : 0, target.job_match_id),
      database.prepare(`
        DELETE FROM notification_items
        WHERE job_match_id = ? AND notification_id IN (
          SELECT id FROM notifications WHERE status <> 'sent'
        ) AND ? <> 'approve'
      `).bind(target.job_match_id, decision),
      database.prepare(`
        DELETE FROM notifications
        WHERE status <> 'sent' AND NOT EXISTS (
          SELECT 1 FROM notification_items WHERE notification_id = notifications.id
        )
      `),
      database.prepare(`
        UPDATE match_profiles
        SET next_digest_at = CASE
          WHEN ? = 'approve' AND (next_digest_at IS NULL OR next_digest_at > ?) THEN ?
          ELSE next_digest_at
        END,
        updated_at = CURRENT_TIMESTAMP
        WHERE id = 'chanyoung-resume'
      `).bind(decision, now, now),
    ]);
    result.accepted += 1;
    if (decision === "approve") result.approved += 1;
    else result.rejected += 1;
  }
  return result;
};
