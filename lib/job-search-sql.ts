import type { JobFilters } from "./domain";
import { ftsQuery } from "./job-search";

export interface JobSearchPlan {
  pageSql: string;
  countSql: string;
  bindings: unknown[];
  limit: number;
  offset: number;
}

const asValues = (values: string[] | undefined): string[] => {
  const seen = new Set<string>();
  return (values ?? []).flatMap((value) => value.split(","))
    .map((value) => value.trim().toLocaleLowerCase())
    .filter((value) => Boolean(value) && !seen.has(value) && Boolean(seen.add(value)));
};

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

export function buildJobSearchPlan(filters: JobFilters): JobSearchPlan {
  const clauses = ["j.status = 'open'"];
  const bindings: unknown[] = [];
  const add = (clause: string, values: unknown[] = []) => {
    clauses.push(clause);
    bindings.push(...values);
  };
  const addAnyEquals = (column: string, values: string[] | undefined) => {
    const normalized = asValues(values);
    if (normalized.length) add(`(${normalized.map(() => `lower(${column}) = ?`).join(" OR ")})`, normalized);
  };
  const addJsonMembership = (column: string, values: string[] | undefined) => {
    const normalized = asValues(values);
    if (normalized.length) {
      add(`(${normalized.map(() =>
        `EXISTS (SELECT 1 FROM json_each(${column}) AS value WHERE lower(value.value) = ?)`
      ).join(" OR ")})`, normalized);
    }
  };

  const query = ftsQuery(filters.query ?? "");
  if (query) add("j.rowid IN (SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH ?)", [query]);

  if (filters.status && filters.status !== "all") add("j.review_state = ?", [filters.status]);
  addAnyEquals("j.company", filters.companies);

  const location = filters.location?.trim().toLocaleLowerCase();
  if (location) add("lower(coalesce(j.location, '')) LIKE ? ESCAPE '\\'", [`%${escapeLike(location)}%`]);

  addAnyEquals("j.location_city", filters.cities);
  addAnyEquals("j.location_state", filters.states);
  addAnyEquals("j.location_country", filters.countries);
  if (filters.arrangement && filters.arrangement !== "all") add("j.arrangement = ?", [filters.arrangement]);
  addAnyEquals("j.employment_type", filters.employmentTypes);

  const recruitingYears = [...new Set((filters.recruitingYears ?? []).filter((year) =>
    Number.isSafeInteger(year) && year >= 2000 && year <= 2100,
  ))];
  if (recruitingYears.length) {
    add(`(${recruitingYears.map(() => "lower(j.title) LIKE ?").join(" OR ")})`, recruitingYears.map((year) => `%${year}%`));
  }

  const programClauses: string[] = [];
  const programBindings: string[] = [];
  for (const program of asValues(filters.programTypes)) {
    if (program === "internship") {
      programClauses.push("lower(j.title) LIKE ?");
      programBindings.push("%intern%");
    } else if (program === "coop") {
      programClauses.push("(lower(j.title) LIKE ? OR lower(j.title) LIKE ?)");
      programBindings.push("%co-op%", "%coop%");
    } else if (program === "regular") {
      programClauses.push("lower(j.title) LIKE ?");
      programBindings.push("%regular%");
    }
  }
  if (programClauses.length) add(`(${programClauses.join(" OR ")})`, programBindings);

  const seasons = asValues(filters.seasons);
  if (seasons.length) {
    add(`(${seasons.map(() => "lower(j.title) LIKE ?").join(" OR ")})`, seasons.map((season) => `%${season}%`));
  }

  if (filters.postedAfter) add("date(j.published_at) >= date(?)", [filters.postedAfter]);
  if (filters.postedBefore) add("date(j.published_at) <= date(?)", [filters.postedBefore]);

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

  const rankedCte = `WITH ranked AS (
  SELECT j.*, row_number() OVER (PARTITION BY j.official_url ORDER BY j.first_seen_at DESC, j.company ASC, j.id ASC) AS dedupe_rank
  FROM jobs j
  WHERE ${clauses.join(" AND ")}
)`;
  const limit = validPageSize(filters.pageSize);
  const offset = (validPage(filters.page) - 1) * limit;

  return {
    pageSql: `${rankedCte}
SELECT ranked.* FROM ranked
WHERE dedupe_rank = 1
ORDER BY first_seen_at DESC, company ASC, id ASC
LIMIT ? OFFSET ?`,
    countSql: `${rankedCte}
SELECT count(*) AS total FROM ranked
WHERE dedupe_rank = 1`,
    bindings,
    limit,
    offset,
  };
}
