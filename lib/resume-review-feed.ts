import { canonicalOpenJobNotExists } from "./job-canonical";
import { internshipOrCoopSql } from "./job-program-policy";

export interface ResumeReviewCandidate {
  matchId: string;
  jobId: string;
  company: string;
  title: string;
  location: string | null;
  locationRegion: string;
  officialUrl: string;
  applyUrl: string | null;
  summary: string | null;
  description: string | null;
  responsibilities: string | null;
  qualifications: string | null;
  skills: string[];
  department: string | null;
  team: string | null;
  jobFamily: string | null;
  jobFunction: string | null;
  employmentType: string | null;
  educationRequirements: string | null;
  experienceRequirements: string | null;
  securityClearance: string | null;
  publishedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  score: number;
  matchedTerms: string[];
  programKeys: string[];
  recruitingYears: number[];
}

type Row = {
  match_id: string;
  job_id: string;
  company: string;
  title: string;
  location: string | null;
  location_region: string;
  official_url: string;
  apply_url: string | null;
  summary: string | null;
  description: string | null;
  responsibilities: string | null;
  qualifications: string | null;
  skills: string | null;
  department: string | null;
  team: string | null;
  job_family: string | null;
  job_function: string | null;
  employment_type: string | null;
  education_requirements: string | null;
  experience_requirements: string | null;
  security_clearance: string | null;
  published_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  score: number;
  matched_terms: string | null;
  program_keys: string | null;
  recruiting_years: string | null;
};

type CandidateIndexRow = {
  match_id: string;
  job_id: string;
  score: number;
  ranking_time: string;
  requisition_identity_key: string | null;
  external_identity_key: string | null;
  url_identity_key: string | null;
};

type IdentityRow = { identity_key: string };
type ReviewProfileRow = { keyword_id: string; activation_watermark: string | null };
type CandidatePriorityBucket = 0 | 1 | 2 | 3;

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
  .filter((item) => Number.isSafeInteger(item));

const boundedLimit = (value: number | undefined): number => Math.max(1, Math.min(100, Math.trunc(value ?? 100)));

// Keep the JSON identity bind comfortably below D1's statement-size ceiling
// even when an ATS emits unusually long application URLs.
const CANDIDATE_PAGE_SIZE = 250;
const MAX_CANDIDATES_SCANNED = 50_000;
const CANDIDATE_PRIORITY_BUCKETS: readonly CandidatePriorityBucket[] = [0, 1, 2, 3];

const identityKeys = (row: CandidateIndexRow): string[] => [
  row.requisition_identity_key,
  row.external_identity_key,
  row.url_identity_key,
].filter((value): value is string => Boolean(value));

const excludedIdentityKeys = async (
  database: D1Database,
  keys: string[],
): Promise<Set<string>> => {
  if (keys.length === 0) return new Set();
  const result = await database.prepare(`
    WITH requested(identity_key) AS (
      SELECT DISTINCT value FROM json_each(?)
    ), reviewed(identity_key) AS (
      SELECT prior_job.requisition_identity_key
      FROM codex_reviews prior_review
      JOIN job_matches prior_match ON prior_match.id = prior_review.job_match_id
      JOIN jobs prior_job ON prior_job.id = prior_match.job_id
      JOIN requested ON requested.identity_key = prior_job.requisition_identity_key
      WHERE prior_review.profile_id = 'chanyoung-resume'
      UNION
      SELECT prior_job.external_identity_key
      FROM codex_reviews prior_review
      JOIN job_matches prior_match ON prior_match.id = prior_review.job_match_id
      JOIN jobs prior_job ON prior_job.id = prior_match.job_id
      JOIN requested ON requested.identity_key = prior_job.external_identity_key
      WHERE prior_review.profile_id = 'chanyoung-resume'
      UNION
      SELECT prior_job.url_identity_key
      FROM codex_reviews prior_review
      JOIN job_matches prior_match ON prior_match.id = prior_review.job_match_id
      JOIN jobs prior_job ON prior_job.id = prior_match.job_id
      JOIN requested ON requested.identity_key = prior_job.url_identity_key
      WHERE prior_review.profile_id = 'chanyoung-resume'
    )
    SELECT identity_key FROM reviewed WHERE identity_key IS NOT NULL
    UNION
    SELECT history.identity_key
    FROM notification_identity_history history
    JOIN requested ON requested.identity_key = history.identity_key
    WHERE history.profile_id = 'chanyoung-resume'
  `).bind(JSON.stringify(keys)).all<IdentityRow>();
  return new Set(result.results.map((row) => row.identity_key));
};

const candidateIndexPage = async (
  database: D1Database,
  profile: ReviewProfileRow,
  priorityBucket: CandidatePriorityBucket,
  offset: number,
): Promise<CandidateIndexRow[]> => {
  const requires2027 = priorityBucket <= 1;
  const locationPredicate = priorityBucket === 0 || priorityBucket === 2
    ? "j.location_region = 'us'"
    : "COALESCE(j.location_region, 'unknown') <> 'us'";
  const candidateFrom = requires2027
    ? `FROM job_topics priority_year INDEXED BY job_topics_topic_job_idx
       JOIN jobs j ON j.id = priority_year.job_id
      AND priority_year.topic_key = 'year:2027'`
    : "FROM jobs j";
  const yearExclusion = requires2027
    ? ""
    : `AND NOT EXISTS (
        SELECT 1 FROM job_topics priority_year
        WHERE priority_year.job_id = j.id AND priority_year.topic_key = 'year:2027'
      )`;
  const result = await database.prepare(`
    SELECT jm.id AS match_id, j.id AS job_id, jm.score,
           COALESCE(j.published_at, j.first_seen_at) AS ranking_time,
           j.requisition_identity_key, j.external_identity_key, j.url_identity_key
    ${candidateFrom}
    JOIN job_matches jm ON jm.job_id = j.id AND jm.keyword_id = ?
    WHERE ${locationPredicate}
      ${yearExclusion}
      AND jm.is_active = 1 AND jm.notification_eligible = 0
      AND jm.open_generation = j.open_generation AND j.status = 'open'
      AND j.alert_discovered_after_baseline = 1
      AND ${canonicalOpenJobNotExists("j")}
      AND ${internshipOrCoopSql("j")}
      AND (? IS NULL OR j.first_seen_at > ?)
      AND NOT EXISTS (
        SELECT 1 FROM codex_reviews reviewed
        WHERE reviewed.job_match_id = jm.id
      )
    ORDER BY jm.score DESC, ranking_time DESC, jm.id
    LIMIT ? OFFSET ?
  `).bind(
    profile.keyword_id,
    profile.activation_watermark,
    profile.activation_watermark,
    CANDIDATE_PAGE_SIZE,
    offset,
  ).all<CandidateIndexRow>();
  return result.results;
};

const hydrateCandidates = async (
  database: D1Database,
  matchIds: string[],
): Promise<Row[]> => {
  if (matchIds.length === 0) return [];
  const result = await database.prepare(`
    SELECT jm.id AS match_id, j.id AS job_id, j.company, j.title, j.location,
           COALESCE(j.location_region, 'unknown') AS location_region,
           j.official_url, j.apply_url, j.summary, j.description,
           j.responsibilities, j.qualifications, j.skills, j.department, j.team,
           j.job_family, j.job_function, j.employment_type,
           j.education_requirements, j.experience_requirements,
           j.security_clearance, j.published_at, j.first_seen_at, j.last_seen_at,
           jm.score, jm.matched_terms,
           COALESCE((SELECT json_group_array(substr(t.topic_key, 9))
                     FROM job_topics t
                     WHERE t.job_id = j.id AND t.topic_key GLOB 'program:*'), '[]') AS program_keys,
           COALESCE((SELECT json_group_array(substr(t.topic_key, 6))
                     FROM job_topics t
                     WHERE t.job_id = j.id AND t.topic_key GLOB 'year:*'), '[]') AS recruiting_years
    FROM json_each(?) selected
    JOIN job_matches jm ON jm.id = selected.value
    JOIN jobs j ON j.id = jm.job_id
    ORDER BY CAST(selected.key AS INTEGER)
  `).bind(JSON.stringify(matchIds)).all<Row>();
  return result.results;
};

/**
 * Returns current internship/co-op resume matches that still need Codex
 * adjudication. The server deliberately does not decide region, recruiting
 * year, or profile fit; it only supplies the bounded candidate set.
 */
export const listResumeReviewCandidates = async (
  database: D1Database,
  limit?: number,
): Promise<ResumeReviewCandidate[]> => {
  const requestedLimit = boundedLimit(limit);
  const profile = await database.prepare(`
    SELECT keyword_id, activation_watermark
    FROM match_profiles
    WHERE id = 'chanyoung-resume'
  `).first<ReviewProfileRow>();
  if (!profile) return [];
  const selected: CandidateIndexRow[] = [];
  const claimedIdentityKeys = new Set<string>();
  let scanned = 0;

  // Never sort the full pending-match catalog by a CASE expression. D1 must
  // materialize that global sort before applying LIMIT, which becomes
  // prohibitively expensive as the baseline grows. Read each priority bucket
  // independently so the 2027 topic index constrains the highest-value bucket
  // before ranking, then fall through only when a bucket cannot fill the feed.
  // Every earlier candidate claims all of its identities even when excluded;
  // this preserves transitive duplicate suppression across URL/ATS variants.
  for (const priorityBucket of CANDIDATE_PRIORITY_BUCKETS) {
    let offset = 0;
    while (selected.length < requestedLimit && scanned < MAX_CANDIDATES_SCANNED) {
      const page = await candidateIndexPage(database, profile, priorityBucket, offset);
      if (page.length === 0) break;
      const pageKeys = [...new Set(page.flatMap(identityKeys))];
      const excluded = await excludedIdentityKeys(database, pageKeys);

      for (const candidate of page) {
        const keys = identityKeys(candidate);
        const duplicate = keys.some((key) => claimedIdentityKeys.has(key));
        for (const key of keys) claimedIdentityKeys.add(key);
        if (duplicate || keys.some((key) => excluded.has(key))) continue;
        selected.push(candidate);
        if (selected.length >= requestedLimit) break;
      }
      scanned += page.length;
      offset += page.length;
      if (page.length < CANDIDATE_PAGE_SIZE) break;
    }
    if (selected.length >= requestedLimit || scanned >= MAX_CANDIDATES_SCANNED) break;
  }

  const rows = await hydrateCandidates(database, selected.map((candidate) => candidate.match_id));

  return rows.map((row) => ({
    matchId: row.match_id,
    jobId: row.job_id,
    company: row.company,
    title: row.title,
    location: row.location,
    locationRegion: row.location_region,
    officialUrl: row.official_url,
    applyUrl: row.apply_url,
    summary: row.summary,
    description: row.description,
    responsibilities: row.responsibilities,
    qualifications: row.qualifications,
    skills: parseStringArray(row.skills),
    department: row.department,
    team: row.team,
    jobFamily: row.job_family,
    jobFunction: row.job_function,
    employmentType: row.employment_type,
    educationRequirements: row.education_requirements,
    experienceRequirements: row.experience_requirements,
    securityClearance: row.security_clearance,
    publishedAt: row.published_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    score: row.score,
    matchedTerms: parseStringArray(row.matched_terms),
    programKeys: parseStringArray(row.program_keys),
    recruitingYears: parseNumberArray(row.recruiting_years),
  }));
};
