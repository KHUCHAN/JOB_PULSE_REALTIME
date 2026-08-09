import type { JobFilterOptions } from "./domain";

export const jobFilterOptionKeys = [
  "companies", "locations", "cities", "states", "countries", "arrangements",
  "employmentTypes", "recruitingYears", "programTypes", "seasons", "departments",
  "teams", "businessUnits", "jobFamilies", "jobFunctions", "industries", "offices",
  "skills", "experienceLevels", "salaryCurrencies", "salaryIntervals",
  "educationRequirements", "shiftSchedules", "travelRequirements", "securityClearances",
  "languages",
] as const satisfies ReadonlyArray<keyof JobFilterOptions>;

export const emptyJobFilterOptions = (): JobFilterOptions => Object.fromEntries(
  jobFilterOptionKeys.map((key) => [key, []]),
) as unknown as JobFilterOptions;

type FilterOptionCountRow = {
  filter_key: keyof JobFilterOptions;
  value_label: string;
  job_count: number;
};

export const filterOptionsSql = `
  WITH RECURSIVE
  years(year) AS (
    VALUES (2000)
    UNION ALL SELECT year + 1 FROM years WHERE year < 2099
  ),
  seasons(season) AS (VALUES ('spring'), ('summer'), ('fall'), ('winter')),
  programs(program, needle, alternate) AS (
    VALUES ('internship', 'intern', NULL), ('coop', 'co-op', 'coop'), ('regular', 'regular', NULL)
  ),
  ranked AS (
    SELECT
      j.id, j.official_url, j.company, j.title, j.location, j.location_city,
      j.location_state, j.location_country, j.arrangement, j.employment_type,
      j.department, j.team, j.business_unit, j.job_family, j.job_function,
      j.industry, j.office, j.skills, j.experience_level, j.salary_currency,
      j.salary_interval, j.education_requirements, j.shift_schedule,
      j.travel_requirements, j.security_clearance, j.languages,
      row_number() OVER (
        PARTITION BY j.official_url
        ORDER BY j.first_seen_at DESC, j.company ASC, j.id ASC
      ) AS dedupe_rank
    FROM jobs j
    WHERE j.status = 'open'
  ),
  deduped AS (
    SELECT * FROM ranked WHERE dedupe_rank = 1
  ),
  facet_values(official_url, filter_key, value) AS (
    SELECT d.official_url, scalar.key, scalar.value
    FROM deduped d, json_each(json_object(
      'companies', d.company,
      'locations', d.location,
      'cities', d.location_city,
      'states', d.location_state,
      'countries', d.location_country,
      'arrangements', d.arrangement,
      'employmentTypes', d.employment_type,
      'departments', d.department,
      'teams', d.team,
      'businessUnits', d.business_unit,
      'jobFamilies', d.job_family,
      'jobFunctions', d.job_function,
      'industries', d.industry,
      'offices', d.office,
      'experienceLevels', d.experience_level,
      'salaryCurrencies', d.salary_currency,
      'salaryIntervals', d.salary_interval,
      'educationRequirements', d.education_requirements,
      'shiftSchedules', d.shift_schedule,
      'travelRequirements', d.travel_requirements,
      'securityClearances', d.security_clearance
    )) scalar
    UNION ALL SELECT d.official_url, 'recruitingYears', CAST(y.year AS TEXT)
      FROM deduped d JOIN years y ON instr(d.title, CAST(y.year AS TEXT)) > 0
    UNION ALL SELECT d.official_url, 'programTypes', p.program
      FROM deduped d JOIN programs p
        ON instr(lower(d.title), p.needle) > 0
        OR (p.alternate IS NOT NULL AND instr(lower(d.title), p.alternate) > 0)
    UNION ALL SELECT d.official_url, 'seasons', s.season
      FROM deduped d JOIN seasons s ON instr(lower(d.title), s.season) > 0
    UNION ALL SELECT d.official_url, arrays.key, CAST(item.value AS TEXT)
      FROM deduped d,
        json_each(json_object(
          'skills', json(CASE WHEN json_valid(d.skills) THEN d.skills ELSE '[]' END),
          'languages', json(CASE WHEN json_valid(d.languages) THEN d.languages ELSE '[]' END)
        )) arrays,
        json_each(arrays.value) item
      WHERE arrays.type = 'array' AND item.type = 'text'
  ),
  counted AS (
    SELECT
      filter_key,
      min(trim(CAST(value AS TEXT))) AS value_label,
      count(DISTINCT official_url) AS job_count
    FROM facet_values
    WHERE value IS NOT NULL AND trim(CAST(value AS TEXT)) <> ''
      AND (
        filter_key <> 'employmentTypes'
        OR lower(replace(replace(replace(replace(trim(CAST(value AS TEXT)), '_', ''), '-', ''), ' ', ''), '/', '')) IN (
          'fulltime', 'fulltimeemployee', 'modifiedfulltime', 'parttime', 'temporary',
          'contractor', 'contract', 'intern', 'internship', 'regular', 'permanent',
          'seasonal', 'casual', 'freelance', 'apprentice', 'apprenticeship',
          'fixedterm', 'fixedtermcontract', 'employeeregularpermanent'
        )
      )
    GROUP BY filter_key, lower(trim(CAST(value AS TEXT)))
  ),
  bounded AS (
    SELECT *, row_number() OVER (
      PARTITION BY filter_key
      ORDER BY job_count DESC, value_label COLLATE NOCASE ASC
    ) AS facet_rank
    FROM counted
  )
  SELECT filter_key, value_label, job_count
  FROM bounded
  WHERE facet_rank <= 100
  ORDER BY filter_key ASC, facet_rank ASC
`;

export async function queryJobFilterOptions(database: D1Database): Promise<JobFilterOptions> {
  const result = await database.prepare(filterOptionsSql).all<FilterOptionCountRow>();
  const options = emptyJobFilterOptions();
  const validKeys = new Set<keyof JobFilterOptions>(jobFilterOptionKeys);
  for (const row of result.results) {
    if (!validKeys.has(row.filter_key)) continue;
    const value = row.filter_key === "recruitingYears" ? Number(row.value_label) : row.value_label;
    if (typeof value === "number" && !Number.isSafeInteger(value)) continue;
    options[row.filter_key].push({ value, count: Number(row.job_count) } as never);
  }
  return options;
}
