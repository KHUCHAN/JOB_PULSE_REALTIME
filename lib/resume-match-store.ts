import {
  CHANYOUNG_RESUME_PROFILE,
  evaluateResumeMatch,
  type ResumeMatchDecision,
  type ResumeMatchInput,
} from "./resume-match";
import { canonicalOpenJobNotExists } from "./job-canonical";

export interface ResumeMatchCandidate extends ResumeMatchInput {
  openGeneration: number;
  reopenedAt: string | null;
}

export interface ResumeBackfillResult {
  processed: number;
  matched: number;
  nextCursor: string | null;
  remaining: number;
}

type ProfileRow = {
  id: string;
  keyword_id: string;
  enabled: number;
  activation_watermark: string | null;
};

type CandidateRow = {
  id: string;
  title: string;
  company: string;
  location_region: ResumeMatchInput["locationRegion"] | null;
  summary: string | null;
  description: string | null;
  responsibilities: string | null;
  qualifications: string | null;
  skills: string | null;
  job_family: string | null;
  job_function: string | null;
  education_requirements: string | null;
  experience_requirements: string | null;
  security_clearance: string | null;
  published_at: string | null;
  first_seen_at: string;
  official_url: string;
  open_generation: number;
  reopened_at: string | null;
  program_keys: string | null;
  recruiting_years: string | null;
};

type LoadedResumeMatchCandidate = ResumeMatchCandidate & { officialUrl: string };

const parseStringArray = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const parseNumberArray = (value: string | null): number[] => parseStringArray(value)
  .map(Number)
  .filter(Number.isFinite);

const asCandidate = (row: CandidateRow): LoadedResumeMatchCandidate => ({
  id: row.id,
  title: row.title,
  company: row.company,
  locationRegion: row.location_region ?? "unknown",
  programKeys: parseStringArray(row.program_keys),
  summary: row.summary,
  description: row.description,
  responsibilities: row.responsibilities,
  qualifications: row.qualifications,
  skills: parseStringArray(row.skills),
  jobFamily: row.job_family,
  jobFunction: row.job_function,
  educationRequirements: row.education_requirements,
  experienceRequirements: row.experience_requirements,
  securityClearance: row.security_clearance,
  recruitingYears: parseNumberArray(row.recruiting_years),
  publishedAt: row.published_at,
  firstSeenAt: row.first_seen_at,
  officialUrl: row.official_url,
  openGeneration: row.open_generation,
  reopenedAt: row.reopened_at,
});

const profile = async (database: D1Database): Promise<ProfileRow | null> => {
  const result = await database.prepare(`
    SELECT id, keyword_id, enabled, activation_watermark
    FROM match_profiles
    WHERE id = ?
    LIMIT 1
  `).bind(CHANYOUNG_RESUME_PROFILE.id).all<ProfileRow>();
  return result.results[0] ?? null;
};

const jsonChunks = <T>(values: T[], maxBytes = 1_500_000): T[][] => {
  const encoder = new TextEncoder();
  const result: T[][] = [];
  let chunk: T[] = [];
  let size = 2;
  for (const value of values) {
    const valueSize = encoder.encode(JSON.stringify(value)).byteLength;
    if (valueSize + 2 > maxBytes) throw new Error("Resume match record exceeds the D1 payload limit.");
    if (size + valueSize + (chunk.length ? 1 : 0) > maxBytes) {
      result.push(chunk);
      chunk = [];
      size = 2;
    }
    chunk.push(value);
    size += valueSize + (chunk.length > 1 ? 1 : 0);
  }
  if (chunk.length) result.push(chunk);
  return result;
};

// The crawler owns only the coarse student-program gate. Codex reviews region,
// year, role, authorization, profile fit, and any stated work-term dates before
// a notification is enabled.
const isProgramCandidate = (candidate: ResumeMatchCandidate): boolean =>
  candidate.programKeys.some((key) => key === "internship" || key === "coop");

const persistDecisions = async (
  database: D1Database,
  profileRow: ProfileRow,
  values: Array<{ candidate: ResumeMatchCandidate; decision: ResumeMatchDecision; notificationEligible?: boolean }>,
  now: string,
): Promise<{ matched: number; deactivated: number }> => {
  const active = values
    .filter(({ candidate }) => isProgramCandidate(candidate))
    .map(({ candidate, decision }) => {
      const matchedTerms = decision.evidence.map((item) => `${item.code}|${item.label}|${item.points}`);
        matchedTerms.push("candidate:student-program|Server program gate: internship or co-op|0");
      return {
        id: crypto.randomUUID(),
        jobId: candidate.id,
        keywordId: profileRow.keyword_id,
        score: decision.score,
        matchedTerms,
        openGeneration: candidate.openGeneration,
        // Never auto-send a crawler match. A Codex review with decision=approve
        // is the only path that enables the Gmail notification queue.
        notificationEligible: 0,
      };
    });
  for (const chunk of jsonChunks(active)) {
    await database.prepare(`
      INSERT INTO job_matches (
        id, job_id, keyword_id, score, matched_terms, open_generation,
        is_active, notification_eligible, created_at
      )
      SELECT
        json_extract(value, '$.id'), json_extract(value, '$.jobId'),
        json_extract(value, '$.keywordId'), json_extract(value, '$.score'),
        json_extract(value, '$.matchedTerms'), json_extract(value, '$.openGeneration'),
        1,
        CASE (
          SELECT reviewed.decision
          FROM codex_reviews reviewed
          JOIN job_matches reviewed_match ON reviewed_match.id = reviewed.job_match_id
          JOIN jobs reviewed_job ON reviewed_job.id = reviewed_match.job_id
          JOIN jobs current_job ON current_job.id = json_extract(value, '$.jobId')
          WHERE reviewed.profile_id = ?
            AND (
              reviewed_match.job_id = current_job.id
              OR reviewed_job.official_url = current_job.official_url
            )
          ORDER BY reviewed.reviewed_at DESC, reviewed.updated_at DESC
          LIMIT 1
        )
          WHEN 'approve' THEN 1
          WHEN 'reject' THEN 0
          ELSE json_extract(value, '$.notificationEligible')
        END,
        ?
      FROM json_each(?)
      WHERE true
      ON CONFLICT(job_id, keyword_id, open_generation) DO UPDATE SET
        score = excluded.score,
        matched_terms = excluded.matched_terms,
        is_active = 1,
        notification_eligible = max(job_matches.notification_eligible, excluded.notification_eligible)
    `).bind(profileRow.id, now, JSON.stringify(chunk)).run();
  }

  const inactive = values
    .filter(({ candidate }) => !isProgramCandidate(candidate))
    .map(({ candidate }) => ({
    jobId: candidate.id,
    keywordId: profileRow.keyword_id,
    openGeneration: candidate.openGeneration,
  }));
  for (const chunk of jsonChunks(inactive)) {
    await database.prepare(`
      UPDATE job_matches
      SET is_active = 0
      WHERE EXISTS (
        SELECT 1 FROM json_each(?) record
        WHERE job_matches.job_id = json_extract(record.value, '$.jobId')
          AND job_matches.keyword_id = json_extract(record.value, '$.keywordId')
          AND job_matches.open_generation = json_extract(record.value, '$.openGeneration')
      )
    `).bind(JSON.stringify(chunk)).run();
  }
  return { matched: active.length, deactivated: inactive.length };
};

export const syncResumeMatches = async (
  database: D1Database,
  candidates: ResumeMatchCandidate[],
  now: string,
): Promise<{ matched: number; deactivated: number }> => {
  if (candidates.length === 0) return { matched: 0, deactivated: 0 };
  const profileRow = await profile(database);
  if (!profileRow || profileRow.enabled !== 1) return { matched: 0, deactivated: 0 };
  return persistDecisions(database, profileRow, candidates.map((candidate) => ({
    candidate,
    decision: evaluateResumeMatch(candidate),
  })), now);
};

export const loadResumeCandidatesForUrls = async (
  database: D1Database,
  sourceId: string,
  officialUrls: string[],
): Promise<LoadedResumeMatchCandidate[]> => {
  if (officialUrls.length === 0) return [];
  const rows: CandidateRow[] = [];
  for (const chunk of jsonChunks(officialUrls)) {
    const result = await database.prepare(`
      SELECT j.id, j.title, j.company, j.location_region, j.summary, j.description,
             j.responsibilities, j.qualifications, j.skills, j.job_family, j.job_function,
             j.education_requirements, j.experience_requirements, j.security_clearance,
             j.published_at, j.first_seen_at, j.official_url, j.open_generation, j.reopened_at,
             COALESCE((SELECT json_group_array(substr(t.topic_key, 9)) FROM job_topics t
               WHERE t.job_id = j.id AND t.topic_key LIKE 'program:%'), '[]') AS program_keys,
             COALESCE((SELECT json_group_array(substr(t.topic_key, 6)) FROM job_topics t
               WHERE t.job_id = j.id AND t.topic_key LIKE 'year:%'), '[]') AS recruiting_years
      FROM jobs j
      WHERE j.source_id = ? AND j.status = 'open'
        AND j.official_url IN (SELECT value FROM json_each(?))
        AND ${canonicalOpenJobNotExists("j")}
    `).bind(sourceId, JSON.stringify(chunk)).all<CandidateRow>();
    rows.push(...result.results);
  }
  return rows.map(asCandidate);
};

export const syncResumeMatchesForUrls = async (
  database: D1Database,
  sourceId: string,
  officialUrls: string[],
  now: string,
  notificationEligibleUrls: string[] = [],
): Promise<{ matched: number; deactivated: number }> => {
  if (officialUrls.length === 0) return { matched: 0, deactivated: 0 };
  const profileRow = await profile(database);
  if (!profileRow || profileRow.enabled !== 1) return { matched: 0, deactivated: 0 };
  const totals = { matched: 0, deactivated: 0 };
  const eligibleUrls = new Set(notificationEligibleUrls);
  for (let index = 0; index < officialUrls.length; index += 1_000) {
    const candidates = await loadResumeCandidatesForUrls(
      database,
      sourceId,
      officialUrls.slice(index, index + 1_000),
    );
    const persisted = await persistDecisions(database, profileRow, candidates.map((candidate) => ({
      candidate,
      decision: evaluateResumeMatch(candidate),
      notificationEligible: eligibleUrls.has(candidate.officialUrl),
    })), now);
    totals.matched += persisted.matched;
    totals.deactivated += persisted.deactivated;
  }
  return totals;
};

export const backfillResumeMatches = async (
  database: D1Database,
  options: { afterId: string | null; limit: number },
): Promise<ResumeBackfillResult> => {
  const profileRow = await profile(database);
  if (!profileRow) throw new Error("Resume match profile is missing.");
  const limit = Math.max(1, Math.min(500, Math.trunc(options.limit)));
  const result = await database.prepare(`
    SELECT j.id, j.title, j.company, j.location_region, j.summary, j.description,
           j.responsibilities, j.qualifications, j.skills, j.job_family, j.job_function,
           j.education_requirements, j.experience_requirements, j.security_clearance,
           j.published_at, j.first_seen_at, j.official_url, j.open_generation, j.reopened_at,
           COALESCE((SELECT json_group_array(substr(t.topic_key, 9)) FROM job_topics t
             WHERE t.job_id = j.id AND t.topic_key LIKE 'program:%'), '[]') AS program_keys,
           COALESCE((SELECT json_group_array(substr(t.topic_key, 6)) FROM job_topics t
             WHERE t.job_id = j.id AND t.topic_key LIKE 'year:%'), '[]') AS recruiting_years
    FROM jobs j
    WHERE j.status = 'open' AND j.id > ?
      AND ${canonicalOpenJobNotExists("j")}
    ORDER BY j.id
    LIMIT ?
  `).bind(options.afterId ?? "", limit + 1).all<CandidateRow>();
  const hasMore = result.results.length > limit;
  const rows = result.results.slice(0, limit).map(asCandidate);
  const decisions = rows.map((candidate) => ({ candidate, decision: evaluateResumeMatch(candidate) }));
  await persistDecisions(database, profileRow, decisions, new Date().toISOString());
  return {
    processed: rows.length,
    matched: decisions.filter(({ decision }) => decision.eligible).length,
    nextCursor: hasMore ? rows.at(-1)?.id ?? null : null,
    remaining: hasMore ? -1 : 0,
  };
};
