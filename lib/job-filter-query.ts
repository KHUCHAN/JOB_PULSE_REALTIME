import type { JobAreaKey, JobFilters, JobProgramType, JobRegion, JobSeason, JobTopicKey } from "./domain";

const programTypes = new Set<JobProgramType>(["internship", "coop", "regular"]);
const seasons = new Set<JobSeason>(["spring", "summer", "fall", "winter"]);
const topicKeys = new Set<JobTopicKey>(["ai-data"]);
const areaKeys = new Set<JobAreaKey>(["ai-ml", "data-analytics", "software-engineering"]);
const regionKeys = new Set<JobRegion>(["us", "non_us", "mixed", "unknown"]);
const statuses = new Set<JobFilters["status"]>(["all", "new", "saved", "hidden", "applied"]);
const arrangements = new Set<JobFilters["arrangement"]>(["all", "onsite", "hybrid", "remote"]);

export const defaultJobFilters: JobFilters = {
  query: "",
  status: "all",
  arrangement: "all",
  location: "",
  topics: [],
  areas: [],
  regions: [],
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
  resumeMatchProfile: undefined,
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

const normalizeAtomicValues = (values: string[]): string[] => {
  const seen = new Set<string>();
  return values.map((value) => value.trim())
    .filter((value) => {
      const normalized = value.toLocaleLowerCase();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
};

const normalizeDelimitedValues = (values: string[]): string[] =>
  normalizeAtomicValues(values.flatMap((value) => value.split(",")));

const normalizeEnumValues = <T extends string>(values: string[] | undefined, allowed: Set<T>): T[] =>
  normalizeDelimitedValues(values ?? [])
    .map((value) => value.toLocaleLowerCase())
    .filter((value): value is T => allowed.has(value as T));

const normalizeYears = (years: number[] | undefined): number[] => [
  ...new Set((years ?? []).filter((year) =>
    Number.isSafeInteger(year) && year >= 2000 && year <= 2100,
  )),
];

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

const isNonNegativeNumber = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0;

const parseDate = (value: string | null): string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value ? "" : value;
};

const appendValues = (params: URLSearchParams, key: string, values: string[] | undefined) => {
  for (const value of normalizeAtomicValues(values ?? [])) params.append(key, value);
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
    (filters[property] as string[]) = normalizeAtomicValues(input.getAll(parameter));
  }

  filters.recruitingYears = normalizeDelimitedValues(input.getAll("year"))
    .map((value) => parseInteger(value))
    .filter((value): value is number => value !== undefined && value >= 2000 && value <= 2100)
    .filter((value, index, values) => values.indexOf(value) === index);

  filters.programTypes = normalizeEnumValues(input.getAll("program"), programTypes);
  filters.seasons = normalizeEnumValues(input.getAll("season"), seasons);
  filters.topics = normalizeEnumValues(input.getAll("topic"), topicKeys);
  filters.areas = normalizeEnumValues(input.getAll("area"), areaKeys);
  filters.regions = normalizeEnumValues(input.getAll("region"), regionKeys);
  filters.postedAfter = parseDate(input.get("postedAfter"));
  filters.postedBefore = parseDate(input.get("postedBefore"));
  filters.salaryMin = parseNonNegativeNumber(input.get("salaryMin"));
  filters.salaryMax = parseNonNegativeNumber(input.get("salaryMax"));
  filters.resumeMatchProfile = input.get("resumeMatch") === "chanyoung-resume"
    ? "chanyoung-resume"
    : undefined;

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
  if (normalized.status !== "all" && statuses.has(normalized.status)) {
    params.append("status", normalized.status);
  }
  if (normalized.arrangement !== "all" && arrangements.has(normalized.arrangement)) {
    params.append("arrangement", normalized.arrangement);
  }
  appendText("location", normalized.location);
  if (normalized.resumeMatchProfile === "chanyoung-resume") {
    params.append("resumeMatch", normalized.resumeMatchProfile);
  }
  for (const topic of normalizeEnumValues(normalized.topics, topicKeys)) params.append("topic", topic);
  for (const area of normalizeEnumValues(normalized.areas, areaKeys)) params.append("area", area);
  for (const region of normalizeEnumValues(normalized.regions, regionKeys)) params.append("region", region);
  for (const [parameter, property] of arrayKeys.slice(0, 5)) {
    appendValues(params, parameter, normalized[property] as string[] | undefined);
  }
  for (const year of normalizeYears(normalized.recruitingYears)) params.append("year", String(year));
  for (const program of normalizeEnumValues(normalized.programTypes, programTypes)) params.append("program", program);
  for (const season of normalizeEnumValues(normalized.seasons, seasons)) params.append("season", season);
  if (parseDate(normalized.postedAfter ?? "")) params.append("postedAfter", normalized.postedAfter!);
  if (parseDate(normalized.postedBefore ?? "")) params.append("postedBefore", normalized.postedBefore!);
  if (isNonNegativeNumber(normalized.salaryMin)) {
    params.append("salaryMin", String(normalized.salaryMin));
  }
  if (isNonNegativeNumber(normalized.salaryMax)) {
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
    (count, [, property]) => count + Number(normalizeAtomicValues(
      normalized[property] as string[] | undefined ?? [],
    ).length > 0),
    0,
  );
  return arrayFilterCount
    + Number(Boolean(normalized.query.trim()))
    + Number(normalized.status !== "all" && statuses.has(normalized.status))
    + Number(normalized.arrangement !== "all" && arrangements.has(normalized.arrangement))
    + Number(Boolean(normalized.location.trim()))
    + Number(normalized.resumeMatchProfile === "chanyoung-resume")
    + Number(normalizeEnumValues(normalized.topics, topicKeys).length > 0)
    + Number(normalizeEnumValues(normalized.areas, areaKeys).length > 0)
    + Number(normalizeEnumValues(normalized.regions, regionKeys).length > 0)
    + Number(normalizeYears(normalized.recruitingYears).length > 0)
    + Number(normalizeEnumValues(normalized.programTypes, programTypes).length > 0)
    + Number(normalizeEnumValues(normalized.seasons, seasons).length > 0)
    + Number(Boolean(parseDate(normalized.postedAfter ?? "")))
    + Number(Boolean(parseDate(normalized.postedBefore ?? "")))
    + Number(isNonNegativeNumber(normalized.salaryMin))
    + Number(isNonNegativeNumber(normalized.salaryMax));
}
