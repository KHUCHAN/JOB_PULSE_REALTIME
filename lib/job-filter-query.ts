import type { JobFilters, JobProgramType, JobSeason } from "./domain";

const programTypes = new Set<JobProgramType>(["internship", "coop", "regular"]);
const seasons = new Set<JobSeason>(["spring", "summer", "fall", "winter"]);
const statuses = new Set<JobFilters["status"]>(["all", "new", "saved", "hidden", "applied"]);
const arrangements = new Set<JobFilters["arrangement"]>(["all", "onsite", "hybrid", "remote"]);

export const defaultJobFilters: JobFilters = {
  query: "",
  status: "all",
  arrangement: "all",
  location: "",
  companies: [],
  cities: [],
  states: [],
  countries: [],
  employmentTypes: [],
  recruitingYears: [],
  programTypes: [],
  seasons: [],
  postedAfter: "",
  postedBefore: "",
  departments: [],
  teams: [],
  businessUnits: [],
  jobFamilies: [],
  jobFunctions: [],
  industries: [],
  offices: [],
  skills: [],
  experienceLevels: [],
  salaryMin: undefined,
  salaryMax: undefined,
  salaryCurrencies: [],
  salaryIntervals: [],
  educationRequirements: [],
  shiftSchedules: [],
  travelRequirements: [],
  securityClearances: [],
  languages: [],
  page: 1,
  pageSize: 50,
};

const arrayKeys = [
  ["company", "companies"],
  ["city", "cities"],
  ["state", "states"],
  ["country", "countries"],
  ["employmentType", "employmentTypes"],
  ["department", "departments"],
  ["team", "teams"],
  ["businessUnit", "businessUnits"],
  ["jobFamily", "jobFamilies"],
  ["jobFunction", "jobFunctions"],
  ["industry", "industries"],
  ["office", "offices"],
  ["skill", "skills"],
  ["experienceLevel", "experienceLevels"],
  ["salaryCurrency", "salaryCurrencies"],
  ["salaryInterval", "salaryIntervals"],
  ["education", "educationRequirements"],
  ["shift", "shiftSchedules"],
  ["travel", "travelRequirements"],
  ["clearance", "securityClearances"],
  ["language", "languages"],
] as const satisfies ReadonlyArray<readonly [string, keyof JobFilters]>;

const cloneDefaults = (): JobFilters => ({
  ...defaultJobFilters,
  ...Object.fromEntries(
    Object.entries(defaultJobFilters).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ]),
  ),
});

const normalizeValues = (values: string[]): string[] => {
  const seen = new Set<string>();
  return values.flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => {
      const normalized = value.toLocaleLowerCase();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
};

const parseInteger = (value: string | null): number | undefined => {
  if (!value || !/^-?\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const parseNonNegativeNumber = (value: string | null): number | undefined => {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseDate = (value: string | null): string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value ? "" : value;
};

const appendValues = (params: URLSearchParams, key: string, values: string[] | undefined) => {
  for (const value of normalizeValues(values ?? [])) params.append(key, value);
};

export function parseJobFilterParams(input: URLSearchParams): JobFilters {
  const filters = cloneDefaults();
  filters.query = input.get("q")?.trim() ?? "";
  filters.location = input.get("location")?.trim() ?? "";

  const status = input.get("status")?.trim().toLocaleLowerCase();
  if (status && statuses.has(status as JobFilters["status"])) {
    filters.status = status as JobFilters["status"];
  }

  const arrangement = input.get("arrangement")?.trim().toLocaleLowerCase();
  if (arrangement && arrangements.has(arrangement as JobFilters["arrangement"])) {
    filters.arrangement = arrangement as JobFilters["arrangement"];
  }

  for (const [parameter, property] of arrayKeys) {
    (filters[property] as string[]) = normalizeValues(input.getAll(parameter));
  }

  filters.recruitingYears = normalizeValues(input.getAll("year"))
    .map((value) => parseInteger(value))
    .filter((value): value is number => value !== undefined && value >= 2000 && value <= 2100)
    .filter((value, index, values) => values.indexOf(value) === index);

  filters.programTypes = normalizeValues(input.getAll("program"))
    .map((value) => value.toLocaleLowerCase())
    .filter((value): value is JobProgramType => programTypes.has(value as JobProgramType));
  filters.seasons = normalizeValues(input.getAll("season"))
    .map((value) => value.toLocaleLowerCase())
    .filter((value): value is JobSeason => seasons.has(value as JobSeason));
  filters.postedAfter = parseDate(input.get("postedAfter"));
  filters.postedBefore = parseDate(input.get("postedBefore"));
  filters.salaryMin = parseNonNegativeNumber(input.get("salaryMin"));
  filters.salaryMax = parseNonNegativeNumber(input.get("salaryMax"));

  const page = parseInteger(input.get("page"));
  if (page !== undefined && page >= 1) filters.page = page;
  const pageSize = parseInteger(input.get("pageSize"));
  if (pageSize !== undefined && pageSize >= 1 && pageSize <= 100) filters.pageSize = pageSize;

  return filters;
}

export function serializeJobFilters(filters: JobFilters): URLSearchParams {
  const normalized = { ...defaultJobFilters, ...filters };
  const params = new URLSearchParams();
  const appendText = (key: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed) params.append(key, trimmed);
  };

  appendText("q", normalized.query);
  if (normalized.status !== "all") params.append("status", normalized.status);
  if (normalized.arrangement !== "all") params.append("arrangement", normalized.arrangement);
  appendText("location", normalized.location);
  for (const [parameter, property] of arrayKeys.slice(0, 5)) {
    appendValues(params, parameter, normalized[property] as string[] | undefined);
  }
  for (const year of normalized.recruitingYears ?? []) {
    if (Number.isSafeInteger(year) && year >= 2000 && year <= 2100) params.append("year", String(year));
  }
  for (const program of normalized.programTypes ?? []) {
    if (programTypes.has(program)) params.append("program", program);
  }
  for (const season of normalized.seasons ?? []) {
    if (seasons.has(season)) params.append("season", season);
  }
  if (parseDate(normalized.postedAfter ?? "")) params.append("postedAfter", normalized.postedAfter!);
  if (parseDate(normalized.postedBefore ?? "")) params.append("postedBefore", normalized.postedBefore!);
  if (normalized.salaryMin !== undefined && Number.isFinite(normalized.salaryMin) && normalized.salaryMin >= 0) {
    params.append("salaryMin", String(normalized.salaryMin));
  }
  if (normalized.salaryMax !== undefined && Number.isFinite(normalized.salaryMax) && normalized.salaryMax >= 0) {
    params.append("salaryMax", String(normalized.salaryMax));
  }
  for (const [parameter, property] of arrayKeys.slice(5)) {
    appendValues(params, parameter, normalized[property] as string[] | undefined);
  }
  const page = normalized.page;
  if (page !== undefined && Number.isSafeInteger(page) && page > 1) {
    params.append("page", String(page));
  }
  const pageSize = normalized.pageSize;
  if (pageSize !== undefined && Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 100 && pageSize !== 50) {
    params.append("pageSize", String(pageSize));
  }

  return params;
}

export function activeFilterCount(filters: JobFilters): number {
  const normalized = { ...defaultJobFilters, ...filters };
  const arrayFilterCount = arrayKeys.reduce(
    (count, [, property]) => count + ((normalized[property] as string[] | undefined)?.length ? 1 : 0),
    0,
  );
  return arrayFilterCount
    + Number(Boolean(normalized.query.trim()))
    + Number(normalized.status !== "all")
    + Number(normalized.arrangement !== "all")
    + Number(Boolean(normalized.location.trim()))
    + Number(Boolean(normalized.recruitingYears?.length))
    + Number(Boolean(normalized.programTypes?.length))
    + Number(Boolean(normalized.seasons?.length))
    + Number(Boolean(normalized.postedAfter))
    + Number(Boolean(normalized.postedBefore))
    + Number(normalized.salaryMin !== undefined)
    + Number(normalized.salaryMax !== undefined);
}
