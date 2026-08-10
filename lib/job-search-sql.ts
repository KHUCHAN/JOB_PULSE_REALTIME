import type { JobFilters } from "./domain";
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
  "longitude", "salary_min", "salary_max", "salary_currency", "salary_interval", "benefits",
  "education_requirements", "experience_requirements", "experience_level", "shift_schedule",
  "travel_requirements", "security_clearance", "languages", "requisition_id", "apply_url",
  "source_posted_text", "source_updated_at", "valid_through", "published_at",
] as const;

export const jobDetailProjection = (alias = "j"): string =>
  jobDetailColumns.map((column) => `${alias}.${column} AS ${column}`).join(",\n       ");

const jobListProjection = [
  "j.id AS id", "j.source_id AS source_id", "j.company AS company", "j.title AS title",
  "j.location AS location", "j.arrangement AS arrangement",
  "substr(coalesce(j.summary, j.description), 1, 1200) AS summary",
  "j.official_url AS official_url", "j.first_seen_at AS first_seen_at",
  "j.last_seen_at AS last_seen_at", "j.review_state AS review_state",
].join(",\n       ");

export function buildJobSearchPlan(filters: JobFilters): JobSearchPlan {
  const clauses = ["j.status = 'open'"];
  const bindings: unknown[] = [];
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
    add(`j.id IN (SELECT job_id FROM job_topics WHERE topic_key = ?)`, [topics[0]]);
  }

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
    add(`(${recruitingYears.map((year) => `${titleTokens} LIKE '% ${year} %'`).join(" OR ")})`);
  }

  const programClauses: string[] = [];
  for (const program of asNormalizedValues(filters.programTypes)) {
    if (program === "internship") {
      programClauses.push(`(${titleTokens} LIKE '% intern %' OR ${titleTokens} LIKE '% internship %')`);
    } else if (program === "coop") {
      programClauses.push(`(${titleTokens} LIKE '% co op %' OR ${titleTokens} LIKE '% coop %')`);
    } else if (program === "regular") {
      programClauses.push(`${titleTokens} LIKE '% regular %'`);
    }
  }
  if (programClauses.length) add(`(${programClauses.join(" OR ")})`);

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

  clauses.splice(1, 0, `NOT EXISTS (
    SELECT 1 FROM jobs newer
    WHERE newer.status = 'open'
      AND newer.official_url = j.official_url
      AND (
        newer.first_seen_at > j.first_seen_at
        OR (newer.first_seen_at = j.first_seen_at AND newer.company < j.company)
        OR (newer.first_seen_at = j.first_seen_at AND newer.company = j.company AND newer.id < j.id)
      )
  )`);
  const limit = validPageSize(filters.pageSize);
  const offset = (validPage(filters.page) - 1) * limit;

  return {
    pageSql: `SELECT ${jobListProjection}
FROM jobs j
WHERE ${clauses.join(" AND ")}
ORDER BY j.first_seen_at DESC, j.company ASC, j.id ASC
LIMIT ? OFFSET ?`,
    countSql: `SELECT count(*) AS total
FROM jobs j
WHERE ${clauses.join(" AND ")}`,
    bindings,
    limit,
    offset,
  };
}
