import type { JobFilterOptions } from "./domain";
import { titleTokensSql } from "./job-title-tokens";

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

export type JobFilterOptionsRefreshResult = {
  refreshed: boolean;
  optionCount: number;
  refreshedAt: string | null;
};

const titleTokens = titleTokensSql("j.title");

export const filterOptionsSql = `
  WITH RECURSIVE
  years(year) AS (
    VALUES (2000)
    UNION ALL SELECT year + 1 FROM years WHERE year < 2100
  ),
  seasons(season) AS (VALUES ('spring'), ('summer'), ('fall'), ('winter')),
  ranked AS (
    SELECT
      j.id, j.official_url, j.company, j.title, j.location, j.location_city,
      j.location_state, j.location_country, j.arrangement, j.employment_type,
      j.department, j.team, j.business_unit, j.job_family, j.job_function,
      j.industry, j.office, j.skills, j.experience_level, j.salary_currency,
      j.salary_interval, j.education_requirements, j.shift_schedule,
      j.travel_requirements, j.security_clearance, j.languages,
      ${titleTokens} AS title_tokens,
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
  program_arrays AS (
    SELECT d.official_url, d.title_tokens,
      coalesce((
        SELECT json_group_array(substr(jp.topic_key, length('program:') + 1))
        FROM job_topics jp
        WHERE jp.job_id = d.id AND jp.topic_key LIKE 'program:%'
      ), '[]') AS program_keys
    FROM deduped d
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
      FROM deduped d JOIN years y ON d.title_tokens LIKE '% ' || CAST(y.year AS TEXT) || ' %'
    UNION ALL SELECT p.official_url, 'programTypes', program.value
      FROM program_arrays p,
        json_each(CASE WHEN p.title_tokens LIKE '% regular %'
          THEN json_insert(p.program_keys, '$[#]', 'regular')
          ELSE p.program_keys END) program
    UNION ALL SELECT d.official_url, 'seasons', s.season
      FROM deduped d JOIN seasons s ON d.title_tokens LIKE '% ' || s.season || ' %'
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

const cachedFilterOptionsSql = `
  SELECT filter_key, value_label, job_count
  FROM job_filter_options_cache
  ORDER BY filter_key ASC, job_count DESC, value_label COLLATE NOCASE ASC
`;

const insertCachedFilterOptionsSql = `
  INSERT INTO job_filter_options_cache (
    filter_key, normalized_value, value_label, job_count, refreshed_at
  )
  SELECT
    json_extract(value, '$.filter_key'),
    lower(trim(json_extract(value, '$.value_label'))),
    json_extract(value, '$.value_label'),
    json_extract(value, '$.job_count'),
    ?
  FROM json_each(?)
`;

const rowsToOptions = (rows: FilterOptionCountRow[]): JobFilterOptions => {
  const options = emptyJobFilterOptions();
  const validKeys = new Set<keyof JobFilterOptions>(jobFilterOptionKeys);
  for (const row of rows) {
    if (!validKeys.has(row.filter_key)) continue;
    const value = row.filter_key === "recruitingYears" ? Number(row.value_label) : row.value_label;
    if (typeof value === "number" && !Number.isSafeInteger(value)) continue;
    options[row.filter_key].push({ value, count: Number(row.job_count) } as never);
  }
  return options;
};

export async function queryJobFilterOptions(database: D1Database): Promise<JobFilterOptions> {
  const result = await database.prepare(filterOptionsSql).all<FilterOptionCountRow>();
  return rowsToOptions(result.results);
}

export async function queryCachedJobFilterOptions(database: D1Database): Promise<JobFilterOptions | null> {
  const result = await database.prepare(cachedFilterOptionsSql).all<FilterOptionCountRow>();
  return result.results.length > 0 ? rowsToOptions(result.results) : null;
}

export async function refreshJobFilterOptions(
  database: D1Database,
  options: { force?: boolean; maxAgeMs?: number; now?: Date } = {},
): Promise<JobFilterOptionsRefreshResult> {
  const latest = await database.prepare(`
    SELECT max(refreshed_at) AS refreshed_at, count(*) AS option_count
    FROM job_filter_options_cache
  `).first<{ refreshed_at: string | null; option_count: number }>();
  const now = options.now ?? new Date();
  const maxAgeMs = options.maxAgeMs ?? 60 * 60 * 1000;
  const refreshedAtMs = latest?.refreshed_at
    ? Date.parse(latest.refreshed_at.includes("T") ? latest.refreshed_at : `${latest.refreshed_at.replace(" ", "T")}Z`)
    : Number.NaN;
  if (!options.force && Number.isFinite(refreshedAtMs) && now.getTime() - refreshedAtMs < maxAgeMs) {
    return {
      refreshed: false,
      optionCount: Number(latest?.option_count ?? 0),
      refreshedAt: latest?.refreshed_at ?? null,
    };
  }

  const computed = await database.prepare(filterOptionsSql).all<FilterOptionCountRow>();
  const refreshedAt = now.toISOString();
  await database.batch([
    database.prepare("DELETE FROM job_filter_options_cache"),
    database.prepare(insertCachedFilterOptionsSql).bind(refreshedAt, JSON.stringify(computed.results)),
  ]);
  return {
    refreshed: true,
    optionCount: computed.results.length,
    refreshedAt,
  };
}
