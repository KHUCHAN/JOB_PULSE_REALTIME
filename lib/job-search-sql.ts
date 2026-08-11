import type { JobFilters } from "./domain";
import { canonicalOpenJobNotExists } from "./job-canonical";
import { ftsQuery } from "./job-search";
import { titleTokensSql } from "./job-title-tokens";

export interface JobSearchPlan {
  pageSql: string;
  countSql: string;
  bindings: unknown[];
  limit: number;
  offset: number;
}

const asValues = (values: string[] | undefined): string[] => {
  const seen = new Set<string>();
  return (values ?? [])
    .map((value) => value.trim())
    .filter((value) => {
      const normalized = value.toLocaleLowerCase();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
};

const asNormalizedValues = (values: string[] | undefined): string[] =>
  asValues(values).map((value) => value.toLocaleLowerCase());

const validPageSize = (value: number | undefined): number =>
  Number.isSafeInteger(value) && value! >= 1 && value! <= 100 ? value! : 50;

const validPage = (value: number | undefined): number =>
  Number.isSafeInteger(value) && value! >= 1 ? value! : 1;

const validSalary = (value: number | undefined): number | undefined =>
  Number.isFinite(value) && value! >= 0 ? value : undefined;

const escapeLike = (value: string): string => value
  .replaceAll("\\", "\\\\")
  .replaceAll("%", "\\%")
  .replaceAll("_", "\\_");

const dayAfter = (value: string): string => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

const jobDetailColumns = [
  "id", "source_id", "company", "title", "location", "arrangement", "summary",
  "official_url", "first_seen_at", "last_seen_at", "review_state", "employment_type",
  "description", "responsibilities", "qualifications", "skills", "department", "team",
  "business_unit", "job_family", "job_function", "industry", "office", "secondary_locations",
  "location_city", "location_state", "location_country", "location_postal_code", "latitude",
  "longitude", "location_region", "salary_min", "salary_max", "salary_currency", "salary_interval", "benefits",
  "education_requirements", "experience_requirements", "experience_level", "shift_schedule",
  "travel_requirements", "security_clearance", "languages", "requisition_id", "apply_url",
  "source_posted_text", "source_updated_at", "valid_through", "published_at",
] as const;

const areaKeysProjection = (alias: string): string => `coalesce((
         SELECT json_group_array(area_key)
         FROM (
           SELECT substr(area_topic.topic_key, length('area:') + 1) AS area_key
           FROM job_topics area_topic
           WHERE area_topic.job_id = ${alias}.id AND area_topic.topic_key LIKE 'area:%'
           ORDER BY area_topic.topic_key
         )
       ), '[]') AS area_keys`;

export const jobDetailProjection = (alias = "j"): string => [
  ...jobDetailColumns.map((column) => `${alias}.${column} AS ${column}`),
  areaKeysProjection(alias),
  `(SELECT detail_match.score
    FROM job_matches detail_match
    JOIN match_profiles detail_profile ON detail_profile.keyword_id = detail_match.keyword_id
    WHERE detail_profile.id = 'chanyoung-resume'
      AND detail_match.job_id = ${alias}.id
      AND detail_match.open_generation = ${alias}.open_generation
      AND detail_match.is_active = 1
    LIMIT 1) AS resume_match_score`,
  `(SELECT detail_match.matched_terms
    FROM job_matches detail_match
    JOIN match_profiles detail_profile ON detail_profile.keyword_id = detail_match.keyword_id
    WHERE detail_profile.id = 'chanyoung-resume'
      AND detail_match.job_id = ${alias}.id
      AND detail_match.open_generation = ${alias}.open_generation
      AND detail_match.is_active = 1
    LIMIT 1) AS resume_match_evidence`,
].join(",\n       ");

const jobListProjection = (withResumeMatch: boolean): string => [
  "j.id AS id", "j.source_id AS source_id", "j.company AS company", "j.title AS title",
  "j.location AS location", "j.arrangement AS arrangement",
  "substr(coalesce(j.summary, j.description), 1, 1200) AS summary",
  "j.official_url AS official_url", "j.first_seen_at AS first_seen_at",
  "j.last_seen_at AS last_seen_at", "j.review_state AS review_state",
  "j.employment_type AS employment_type", "j.published_at AS published_at",
  "j.location_region AS location_region", areaKeysProjection("j"),
  withResumeMatch ? "resume_match.score AS resume_match_score" : "NULL AS resume_match_score",
  withResumeMatch ? "resume_match.matched_terms AS resume_match_evidence" : "NULL AS resume_match_evidence",
].join(",\n       ");

export function buildJobSearchPlan(filters: JobFilters): JobSearchPlan {
  const clauses = ["j.status = 'open'"];
  const bindings: unknown[] = [];
  const fromBindings: unknown[] = [];
  const add = (clause: string, values: unknown[] = []) => {
    clauses.push(clause);
    bindings.push(...values);
  };
  const addAnyEquals = (column: string, values: string[] | undefined) => {
    const normalized = asValues(values);
    if (normalized.length) {
      add(`(${normalized.map(() => `${column} = ? COLLATE NOCASE`).join(" OR ")})`, normalized);
    }
  };
  const addJsonMembership = (column: string, values: string[] | undefined) => {
    const normalized = asNormalizedValues(values);
    if (normalized.length) {
      add(`(${normalized.map(() =>
        `EXISTS (SELECT 1 FROM json_each(${column}) AS value WHERE lower(value.value) = ?)`
      ).join(" OR ")})`, normalized);
    }
  };

  const query = ftsQuery(filters.query ?? "");
  if (query) add("j.rowid IN (SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH ?)", [query]);

  const topics = asNormalizedValues(filters.topics).filter((topic) => topic === "ai-data");
  if (topics.length) {
    add("selected_topic.topic_key = ?", [topics[0]]);
  }
  let fromSql = topics.length
    ? "FROM job_topics selected_topic INDEXED BY job_topics_topic_job_idx JOIN jobs j ON j.id = selected_topic.job_id"
    : "FROM jobs j";
  const resumeMatchSelected = filters.resumeMatchProfile === "chanyoung-resume";
  if (resumeMatchSelected) {
    fromSql += `
JOIN match_profiles selected_profile ON selected_profile.id = ?
JOIN job_matches resume_match
  ON resume_match.keyword_id = selected_profile.keyword_id
 AND resume_match.job_id = j.id
 AND resume_match.open_generation = j.open_generation
 AND resume_match.is_active = 1`;
    fromBindings.push("chanyoung-resume");
  }

  const areas = asNormalizedValues(filters.areas)
    .filter((area) => ["ai-ml", "data-analytics", "software-engineering"].includes(area))
    .map((area) => `area:${area}`);
  if (areas.length) {
    add(`j.id IN (
      SELECT selected_area.job_id
      FROM job_topics selected_area INDEXED BY job_topics_topic_job_idx
      WHERE selected_area.topic_key IN (${areas.map(() => "?").join(", ")})
    )`, areas);
  }
  addAnyEquals("j.location_region", filters.regions);

  if (filters.status && filters.status !== "all") add("j.review_state = ?", [filters.status]);
  addAnyEquals("j.company", filters.companies);

  const location = filters.location?.trim().toLocaleLowerCase();
  if (location) add("lower(coalesce(j.location, '')) LIKE ? ESCAPE '\\'", [`%${escapeLike(location)}%`]);

  addAnyEquals("j.location_city", filters.cities);
  addAnyEquals("j.location_state", filters.states);
  addAnyEquals("j.location_country", filters.countries);
  if (filters.arrangement && filters.arrangement !== "all") add("j.arrangement = ?", [filters.arrangement]);
  addAnyEquals("j.employment_type", filters.employmentTypes);

  const titleTokens = titleTokensSql("j.title");
  const recruitingYears = [...new Set((filters.recruitingYears ?? []).filter((year) =>
    Number.isSafeInteger(year) && year >= 2000 && year <= 2100,
  ))];
  if (recruitingYears.length) {
    const yearTopicKeys = recruitingYears.map((year) => `'year:${year}'`);
    add(`(${recruitingYears.map((year) => `${titleTokens} LIKE '% ${year} %'`).join(" OR ")}
      OR j.id IN (
        SELECT selected_year.job_id
        FROM job_topics selected_year INDEXED BY job_topics_topic_job_idx
        WHERE selected_year.topic_key IN (${yearTopicKeys.join(", ")})
      ))`);
  }

  const selectedPrograms = asNormalizedValues(filters.programTypes);
  const indexedPrograms = selectedPrograms.filter((program) => program === "internship" || program === "coop");
  const programTopicKeys = indexedPrograms.map((program) => `program:${program}`);
  const programClauses: string[] = [];
  if (indexedPrograms.length > 0) {
    programClauses.push(`j.id IN (
      SELECT selected_program.job_id
      FROM job_topics selected_program INDEXED BY job_topics_topic_job_idx
      WHERE selected_program.topic_key IN (${programTopicKeys.map(() => "?").join(", ")})
    )`);
  }
  if (selectedPrograms.includes("regular")) programClauses.push(`${titleTokens} LIKE '% regular %'`);
  if (programClauses.length) add(`(${programClauses.join(" OR ")})`, programTopicKeys);

  const seasons = asNormalizedValues(filters.seasons);
  if (seasons.length) {
    add(`(${seasons.map((season) => `${titleTokens} LIKE '% ${escapeLike(season)} %'`).join(" OR ")})`);
  }

  if (filters.postedAfter) add("j.published_at >= ?", [filters.postedAfter]);
  if (filters.postedBefore) add("j.published_at < ?", [dayAfter(filters.postedBefore)]);

  addAnyEquals("j.department", filters.departments);
  addAnyEquals("j.team", filters.teams);
  addAnyEquals("j.business_unit", filters.businessUnits);
  addAnyEquals("j.job_family", filters.jobFamilies);
  addAnyEquals("j.job_function", filters.jobFunctions);
  addAnyEquals("j.industry", filters.industries);
  addAnyEquals("j.office", filters.offices);
  addJsonMembership("j.skills", filters.skills);
  addAnyEquals("j.experience_level", filters.experienceLevels);

  const salaryMin = validSalary(filters.salaryMin);
  if (salaryMin !== undefined) add("j.salary_max >= ?", [salaryMin]);
  const salaryMax = validSalary(filters.salaryMax);
  if (salaryMax !== undefined) add("j.salary_min <= ?", [salaryMax]);
  addAnyEquals("j.salary_currency", filters.salaryCurrencies);
  addAnyEquals("j.salary_interval", filters.salaryIntervals);
  addAnyEquals("j.education_requirements", filters.educationRequirements);
  addAnyEquals("j.shift_schedule", filters.shiftSchedules);
  addAnyEquals("j.travel_requirements", filters.travelRequirements);
  addAnyEquals("j.security_clearance", filters.securityClearances);
  addJsonMembership("j.languages", filters.languages);

  clauses.splice(1, 0, canonicalOpenJobNotExists("j"));
  const limit = validPageSize(filters.pageSize);
  const offset = (validPage(filters.page) - 1) * limit;

  return {
    pageSql: `SELECT ${jobListProjection(resumeMatchSelected)}
${fromSql}
WHERE ${clauses.join(" AND ")}
ORDER BY ${resumeMatchSelected ? "resume_match.score DESC, COALESCE(j.published_at, j.first_seen_at) DESC" : "j.first_seen_at DESC"}, j.company ASC, j.id ASC
LIMIT ? OFFSET ?`,
    countSql: `SELECT count(*) AS total
${fromSql}
WHERE ${clauses.join(" AND ")}`,
    bindings: [...fromBindings, ...bindings],
    limit,
    offset,
  };
}
