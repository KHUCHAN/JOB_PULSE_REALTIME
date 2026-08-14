import { canonicalOpenJobNotExists } from "./job-canonical";
import { internshipOnlySql } from "./job-program-policy";

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

/**
 * Returns current internship (not co-op) resume matches that still need Codex
 * adjudication. The server deliberately does not decide region, recruiting
 * year, or profile fit; it only supplies the bounded candidate set.
 */
export const listResumeReviewCandidates = async (
  database: D1Database,
  limit?: number,
): Promise<ResumeReviewCandidate[]> => {
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
    FROM job_matches jm
    JOIN match_profiles mp ON mp.keyword_id = jm.keyword_id
    JOIN jobs j ON j.id = jm.job_id
    WHERE mp.id = 'chanyoung-resume'
      AND jm.is_active = 1 AND jm.notification_eligible = 0
      AND jm.open_generation = j.open_generation AND j.status = 'open'
      AND ${canonicalOpenJobNotExists("j")}
      AND ${internshipOnlySql("j")}
      AND NOT EXISTS (
        SELECT 1 FROM codex_reviews reviewed
        WHERE reviewed.job_match_id = jm.id
      )
    ORDER BY COALESCE(j.published_at, j.first_seen_at) DESC, jm.id
    LIMIT ?
  `).bind(boundedLimit(limit)).all<Row>();

  return result.results.map((row) => ({
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
