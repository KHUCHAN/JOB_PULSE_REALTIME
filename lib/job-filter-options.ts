import type { JobFilterOptions } from "./domain";
import { titleTokensSql } from "./job-title-tokens";

export const jobFilterOptionKeys = [
  "companies", "locations", "cities", "states", "countries", "regions", "arrangements",
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

const scalarFilterColumns: Partial<Record<keyof JobFilterOptions, string>> = {
  companies: "j.company",
  locations: "j.location",
  cities: "j.location_city",
  states: "j.location_state",
  countries: "j.location_country",
  regions: "j.location_region",
  arrangements: "j.arrangement",
  employmentTypes: "j.employment_type",
  departments: "j.department",
  teams: "j.team",
  businessUnits: "j.business_unit",
  jobFamilies: "j.job_family",
  jobFunctions: "j.job_function",
  industries: "j.industry",
  offices: "j.office",
  experienceLevels: "j.experience_level",
  salaryCurrencies: "j.salary_currency",
  salaryIntervals: "j.salary_interval",
  educationRequirements: "j.education_requirements",
  shiftSchedules: "j.shift_schedule",
  travelRequirements: "j.travel_requirements",
  securityClearances: "j.security_clearance",
};

const canonicalJobsCte = (projection: string): string => `canonical AS (
    SELECT j.id, j.official_url, ${projection}
    FROM jobs j
    WHERE j.status = 'open'
      AND NOT EXISTS (
        SELECT 1 FROM jobs newer
        WHERE newer.status = 'open'
          AND newer.official_url = j.official_url
          AND (
            newer.first_seen_at > j.first_seen_at
            OR (newer.first_seen_at = j.first_seen_at AND newer.company < j.company)
            OR (newer.first_seen_at = j.first_seen_at AND newer.company = j.company AND newer.id < j.id)
          )
      )
  )`;

const employmentTypePredicate = `AND lower(replace(replace(replace(replace(trim(CAST(value AS TEXT)), '_', ''), '-', ''), ' ', ''), '/', '')) IN (
    'fulltime', 'fulltimeemployee', 'modifiedfulltime', 'parttime', 'temporary',
    'contractor', 'contract', 'intern', 'internship', 'regular', 'permanent',
    'seasonal', 'casual', 'freelance', 'apprentice', 'apprenticeship',
    'fixedterm', 'fixedtermcontract', 'employeeregularpermanent'
  )`;

const boundedFacetSql = (
  key: keyof JobFilterOptions,
  commonTableExpressions: string,
  facetValuesSql: string,
): string => `
  WITH RECURSIVE ${commonTableExpressions},
  facet_values(official_url, value) AS (
    ${facetValuesSql}
  )
  SELECT '${key}' AS filter_key,
         min(trim(CAST(value AS TEXT))) AS value_label,
         count(DISTINCT official_url) AS job_count
  FROM facet_values
  WHERE value IS NOT NULL AND trim(CAST(value AS TEXT)) <> ''
    ${key === "employmentTypes" ? employmentTypePredicate : ""}
  GROUP BY lower(trim(CAST(value AS TEXT)))
  ORDER BY job_count DESC, value_label COLLATE NOCASE ASC
  LIMIT 100
`;

const filterOptionSql = (key: keyof JobFilterOptions): string => {
  const scalarColumn = scalarFilterColumns[key];
  if (scalarColumn) {
    return boundedFacetSql(
      key,
      canonicalJobsCte(`${scalarColumn} AS value`),
      "SELECT official_url, value FROM canonical",
    );
  }
  if (key === "skills" || key === "languages") {
    const column = key === "skills" ? "j.skills" : "j.languages";
    return boundedFacetSql(
      key,
      canonicalJobsCte(`${column} AS values_json`),
      `SELECT c.official_url, CAST(item.value AS TEXT)
       FROM canonical c,
         json_each(CASE WHEN json_valid(c.values_json) THEN c.values_json ELSE '[]' END) item
       WHERE item.type = 'text'`,
    );
  }
  if (key === "programTypes") {
    return boundedFacetSql(
      key,
      canonicalJobsCte(`${titleTokens} AS title_tokens`),
      `SELECT c.official_url, substr(jp.topic_key, length('program:') + 1)
       FROM canonical c JOIN job_topics jp ON jp.job_id = c.id
       WHERE jp.topic_key LIKE 'program:%'
       UNION
       SELECT official_url, 'regular' FROM canonical WHERE title_tokens LIKE '% regular %'`,
    );
  }
  if (key === "seasons") {
    return boundedFacetSql(
      key,
      `${canonicalJobsCte(`${titleTokens} AS title_tokens`)},
       season_values(value) AS (VALUES ('spring'), ('summer'), ('fall'), ('winter'))`,
      `SELECT c.official_url, season.value
       FROM canonical c JOIN season_values season
         ON c.title_tokens LIKE '% ' || season.value || ' %'`,
    );
  }
  return boundedFacetSql(
    "recruitingYears",
    `${canonicalJobsCte(`${titleTokens} AS title_tokens`)},
     title_parts(id, official_url, rest, value) AS (
       SELECT id, official_url, trim(title_tokens), '' FROM canonical
       UNION ALL
       SELECT id, official_url,
         CASE WHEN instr(rest, ' ') = 0 THEN '' ELSE ltrim(substr(rest, instr(rest, ' ') + 1)) END,
         CASE WHEN instr(rest, ' ') = 0 THEN rest ELSE substr(rest, 1, instr(rest, ' ') - 1) END
       FROM title_parts WHERE rest <> ''
     )`,
    `SELECT official_url, value FROM title_parts
       WHERE length(value) = 4 AND value GLOB '[0-9][0-9][0-9][0-9]'
         AND CAST(value AS INTEGER) BETWEEN 2000 AND 2100
     UNION
     SELECT c.official_url, substr(jy.topic_key, length('year:') + 1)
       FROM canonical c JOIN job_topics jy ON jy.job_id = c.id
       WHERE jy.topic_key GLOB 'year:[0-9][0-9][0-9][0-9]'`,
  );
};

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
  const rows: FilterOptionCountRow[] = [];
  for (const key of jobFilterOptionKeys) {
    const result = await database.prepare(filterOptionSql(key)).all<FilterOptionCountRow>();
    rows.push(...result.results);
  }
  return rowsToOptions(rows);
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

  const computed = await queryJobFilterOptions(database);
  const computedRows: FilterOptionCountRow[] = jobFilterOptionKeys.flatMap((filterKey) =>
    computed[filterKey].map(({ value, count }) => ({
      filter_key: filterKey,
      value_label: String(value),
      job_count: count,
    })),
  );
  const refreshedAt = now.toISOString();
  await database.batch([
    database.prepare("DELETE FROM job_filter_options_cache"),
    database.prepare(insertCachedFilterOptionsSql).bind(refreshedAt, JSON.stringify(computedRows)),
  ]);
  return {
    refreshed: true,
    optionCount: computedRows.length,
    refreshedAt,
  };
}
