import type {
  ActivityEvent,
  ActivityFilters,
  CreateKeywordInput,
  JobFilterOptions,
  JobFilters,
  JobPosting,
  JobState,
  KeywordRule,
  SourceRecord,
  TalentState,
} from "./domain";
import { defaultJobFilters } from "./job-filter-query";
import { classifyAiDataJob } from "./job-topic-classifier";
import { classifyJobPrograms } from "./job-program-classifier";
import {
  fixtureActivity,
  fixtureJobs,
  fixtureKeywords,
  fixtureSources,
  fixtureTalentTargets,
} from "./fixtures";
import type { JobPulseRepository } from "./repository";
import type { RichJobPosting } from "./pulse-mappers";

const copy = <T>(value: T): T => structuredClone(value);

const optionKeys = [
  "companies", "locations", "cities", "states", "countries", "arrangements",
  "employmentTypes", "recruitingYears", "programTypes", "seasons", "departments",
  "teams", "businessUnits", "jobFamilies", "jobFunctions", "industries", "offices",
  "skills", "experienceLevels", "salaryCurrencies", "salaryIntervals",
  "educationRequirements", "shiftSchedules", "travelRequirements", "securityClearances",
  "languages",
] as const satisfies ReadonlyArray<keyof JobFilterOptions>;

const normalized = (value: string | null | undefined): string => value?.trim().toLocaleLowerCase() ?? "";
const hasAny = (values: string[] | undefined, candidates: Array<string | null | undefined>): boolean => {
  const selected = new Set((values ?? []).map(normalized).filter(Boolean));
  return selected.size === 0 || candidates.some((candidate) => selected.has(normalized(candidate)));
};
const matchesArray = (values: string[] | undefined, candidates: string[]): boolean => {
  const selected = new Set((values ?? []).map(normalized).filter(Boolean));
  return selected.size === 0 || candidates.some((candidate) => selected.has(normalized(candidate)));
};

const locationParts = (location: string) => {
  const [city = "", stateOrCountry = ""] = location.split(",").map((value) => value.trim());
  const state = /^[A-Z]{2}$/i.test(stateOrCountry) ? stateOrCountry : "";
  const country = state || /united states|\bUS\b/i.test(location) ? "US" : "";
  return { city, state, country };
};

const toRichFixtureJob = (job: JobPosting): RichJobPosting => {
  const { city, state, country } = locationParts(job.location);
  return {
    ...job,
    employmentType: null,
    description: null,
    responsibilities: null,
    qualifications: null,
    skills: [...job.matchedTerms],
    department: null,
    team: null,
    businessUnit: null,
    jobFamily: null,
    jobFunction: null,
    industry: null,
    office: null,
    secondaryLocations: [],
    locationCity: city || null,
    locationState: state || null,
    locationCountry: country || null,
    locationPostalCode: null,
    latitude: null,
    longitude: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryInterval: null,
    benefits: null,
    educationRequirements: null,
    experienceRequirements: null,
    experienceLevel: null,
    shiftSchedule: null,
    travelRequirements: null,
    securityClearance: null,
    languages: [],
    requisitionId: null,
    applyUrl: null,
    sourcePostedText: null,
    sourceUpdatedAt: null,
    validThrough: null,
    publishedAt: null,
  };
};

const matchesTitleTerm = (job: RichJobPosting, values: string[] | undefined): boolean =>
  !values?.length || values.some((value) => normalized(job.title).includes(normalized(value)));

const matchesProgram = (job: RichJobPosting, values: JobFilters["programTypes"]): boolean => {
  if (!values?.length) return true;
  const title = normalized(job.title);
  const programs = classifyJobPrograms(job.title).keys;
  return values.some((program) =>
    (program === "internship" && programs.includes("internship"))
    || (program === "coop" && programs.includes("coop"))
    || (program === "regular" && title.includes("regular")),
  );
};

const matchesYears = (job: RichJobPosting, years: number[] | undefined): boolean =>
  !years?.length || years.some((year) => normalized(job.title).includes(String(year)));

const matchesTopics = (job: RichJobPosting, topics: JobFilters["topics"]): boolean =>
  !topics?.length || topics.some((topic) => topic === "ai-data" && classifyAiDataJob(job).matched);

const emptyOptions = (): JobFilterOptions => Object.fromEntries(
  optionKeys.map((key) => [key, []]),
) as unknown as JobFilterOptions;

const countOptions = (jobs: RichJobPosting[]): JobFilterOptions => {
  const values: Record<keyof JobFilterOptions, Array<string | number>> = {
    companies: jobs.map((job) => job.company), locations: jobs.map((job) => job.location),
    cities: jobs.flatMap((job) => job.locationCity ? [job.locationCity] : []),
    states: jobs.flatMap((job) => job.locationState ? [job.locationState] : []),
    countries: jobs.flatMap((job) => job.locationCountry ? [job.locationCountry] : []),
    arrangements: jobs.map((job) => job.arrangement),
    employmentTypes: jobs.flatMap((job) => job.employmentType ? [job.employmentType] : []),
    recruitingYears: jobs.flatMap((job) => [...job.title.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]))),
    programTypes: jobs.flatMap((job) => {
      const title = normalized(job.title);
      return [...classifyJobPrograms(job.title).keys, ...(title.includes("regular") ? ["regular" as const] : [])];
    }),
    seasons: jobs.flatMap((job) => ["spring", "summer", "fall", "winter"].filter((season) => normalized(job.title).includes(season))),
    departments: jobs.flatMap((job) => job.department ? [job.department] : []),
    teams: jobs.flatMap((job) => job.team ? [job.team] : []),
    businessUnits: jobs.flatMap((job) => job.businessUnit ? [job.businessUnit] : []),
    jobFamilies: jobs.flatMap((job) => job.jobFamily ? [job.jobFamily] : []),
    jobFunctions: jobs.flatMap((job) => job.jobFunction ? [job.jobFunction] : []),
    industries: jobs.flatMap((job) => job.industry ? [job.industry] : []),
    offices: jobs.flatMap((job) => job.office ? [job.office] : []),
    skills: jobs.flatMap((job) => job.skills),
    experienceLevels: jobs.flatMap((job) => job.experienceLevel ? [job.experienceLevel] : []),
    salaryCurrencies: jobs.flatMap((job) => job.salaryCurrency ? [job.salaryCurrency] : []),
    salaryIntervals: jobs.flatMap((job) => job.salaryInterval ? [job.salaryInterval] : []),
    educationRequirements: jobs.flatMap((job) => job.educationRequirements ? [job.educationRequirements] : []),
    shiftSchedules: jobs.flatMap((job) => job.shiftSchedule ? [job.shiftSchedule] : []),
    travelRequirements: jobs.flatMap((job) => job.travelRequirements ? [job.travelRequirements] : []),
    securityClearances: jobs.flatMap((job) => job.securityClearance ? [job.securityClearance] : []),
    languages: jobs.flatMap((job) => job.languages),
  };
  const result = emptyOptions();
  for (const key of optionKeys) {
    const grouped = new Map<string, { value: string | number; count: number }>();
    for (const value of values[key]) {
      const normalizedValue = String(value).trim().toLocaleLowerCase();
      if (!normalizedValue) continue;
      const existing = grouped.get(normalizedValue);
      if (existing) existing.count += 1;
      else grouped.set(normalizedValue, { value, count: 1 });
    }
    result[key] = [...grouped.values()]
      .sort((left, right) => right.count - left.count || String(left.value).localeCompare(String(right.value)))
      .slice(0, 100);
  }
  return result;
};

const matchesFilters = (job: RichJobPosting, filters: JobFilters): boolean => {
  const query = normalized(filters.query);
  const searchable = [job.company, job.title, job.summary, job.location, ...job.matchedTerms, ...job.skills].join(" ").toLocaleLowerCase();
  const publishedDate = (job.publishedAt || job.firstSeenAt).slice(0, 10);
  return (!query || searchable.includes(query))
    && (filters.status === "all" || job.status === filters.status)
    && (filters.arrangement === "all" || job.arrangement === filters.arrangement)
    && (!normalized(filters.location) || normalized(job.location).includes(normalized(filters.location)))
    && hasAny(filters.companies, [job.company])
    && hasAny(filters.cities, [job.locationCity])
    && hasAny(filters.states, [job.locationState])
    && hasAny(filters.countries, [job.locationCountry])
    && hasAny(filters.employmentTypes, [job.employmentType])
    && matchesTopics(job, filters.topics)
    && matchesYears(job, filters.recruitingYears)
    && matchesProgram(job, filters.programTypes)
    && matchesTitleTerm(job, filters.seasons)
    && (!filters.postedAfter || publishedDate >= filters.postedAfter)
    && (!filters.postedBefore || publishedDate <= filters.postedBefore)
    && hasAny(filters.departments, [job.department])
    && hasAny(filters.teams, [job.team])
    && hasAny(filters.businessUnits, [job.businessUnit])
    && hasAny(filters.jobFamilies, [job.jobFamily])
    && hasAny(filters.jobFunctions, [job.jobFunction])
    && hasAny(filters.industries, [job.industry])
    && hasAny(filters.offices, [job.office])
    && matchesArray(filters.skills, job.skills)
    && hasAny(filters.experienceLevels, [job.experienceLevel])
    && (filters.salaryMin === undefined || (job.salaryMax !== null && job.salaryMax >= filters.salaryMin))
    && (filters.salaryMax === undefined || (job.salaryMin !== null && job.salaryMin <= filters.salaryMax))
    && hasAny(filters.salaryCurrencies, [job.salaryCurrency])
    && hasAny(filters.salaryIntervals, [job.salaryInterval])
    && hasAny(filters.educationRequirements, [job.educationRequirements])
    && hasAny(filters.shiftSchedules, [job.shiftSchedule])
    && hasAny(filters.travelRequirements, [job.travelRequirements])
    && hasAny(filters.securityClearances, [job.securityClearance])
    && matchesArray(filters.languages, job.languages);
};

const deduplicate = (jobs: RichJobPosting[]): RichJobPosting[] => {
  const ordered = [...jobs].sort((left, right) =>
    right.firstSeenAt.localeCompare(left.firstSeenAt)
    || left.company.localeCompare(right.company)
    || left.id.localeCompare(right.id),
  );
  const seen = new Set<string>();
  return ordered.filter((job) => !seen.has(job.officialUrl) && Boolean(seen.add(job.officialUrl)));
};

export function createFixtureRepository(): JobPulseRepository {
  const jobs = copy(fixtureJobs).map(toRichFixtureJob);
  const sources = copy(fixtureSources);
  let keywords = copy(fixtureKeywords);
  const talentTargets = copy(fixtureTalentTargets);
  let activity = copy(fixtureActivity);

  const requireRecord = <T extends { id: string }>(
    records: T[],
    id: string,
    label: string,
  ): T => {
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error(`${label} not found: ${id}`);
    return record;
  };

  const searchJobs = async (partialFilters: Partial<JobFilters> = {}) => {
    const filters = { ...defaultJobFilters, ...partialFilters };
    const matchingJobs = deduplicate(jobs.filter((job) => matchesFilters(job, filters)));
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    return copy({
      items: matchingJobs.slice((page - 1) * pageSize, page * pageSize),
      total: matchingJobs.length,
      page,
      pageSize,
    });
  };

  return {
    async getOverview() {
      const latestJobs = [...jobs]
        .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt))
        .slice(0, 5);
      const recentActivity = [...activity]
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, 5);

      return copy({
        newMatches: jobs.filter((job) => job.status === "new").length,
        activeSources: sources.filter((source) =>
          ["healthy", "changed"].includes(source.health),
        ).length,
        sourceErrors: sources.filter((source) =>
          ["blocked", "failed"].includes(source.health),
        ).length,
        unsentAlerts: keywords.filter((keyword) => keyword.enabled && !keyword.lastSentAt)
          .length,
        openTalentTasks: talentTargets.filter((target) => target.state !== "completed")
          .length,
        latestJobs,
        recentActivity,
      });
    },

    searchJobs,

    async getJobFilterOptions() {
      return copy(countOptions(deduplicate(jobs)));
    },

    async listJobs(filters = {}) {
      return (await searchJobs(filters)).items;
    },

    async getJob(jobId) {
      const job = jobs.find((item) => item.id === jobId);
      return job ? copy(job) : null;
    },

    async updateJobState(jobId: string, state: JobState) {
      const job = requireRecord(jobs, jobId, "Job");
      job.status = state;
      return copy(job);
    },

    async listSources(health: SourceRecord["health"] | "all" = "all") {
      return copy(
        health === "all" ? sources : sources.filter((source) => source.health === health),
      );
    },

    async listKeywords() {
      return copy(keywords);
    },

    async createKeyword(input: CreateKeywordInput) {
      const keyword: KeywordRule = {
        id: `keyword-${keywords.length + 1}`,
        ...copy(input),
        enabled: true,
        lastSentAt: null,
      };
      keywords = [keyword, ...keywords];
      return copy(keyword);
    },

    async setKeywordEnabled(keywordId: string, enabled: boolean) {
      const keyword = requireRecord(keywords, keywordId, "Keyword");
      keyword.enabled = enabled;
      return copy(keyword);
    },

    async listTalentTargets(state: TalentState | "all" = "all") {
      return copy(
        state === "all"
          ? talentTargets
          : talentTargets.filter((target) => target.state === state),
      );
    },

    async updateTalentState(
      targetId: string,
      state: TalentState,
      blocker: string | null = null,
    ) {
      const target = requireRecord(talentTargets, targetId, "Talent target");
      target.state = state;
      target.blocker = blocker;
      target.lastAttemptAt = new Date().toISOString();
      return copy(target);
    },

    async listActivity(filters: Partial<ActivityFilters> = {}) {
      const severity = filters.severity ?? "all";
      const kind = filters.kind ?? "all";
      return copy(
        activity
          .filter(
            (event) =>
              (severity === "all" || event.severity === severity) &&
              (kind === "all" || event.kind === kind),
          )
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
      );
    },

    async simulateCrawl() {
      const event: ActivityEvent = {
        id: `activity-demo-${activity.length + 1}`,
        kind: "crawl.demo",
        severity: "info",
        summary: "Demo data · simulated crawl completed; no network request was made.",
        occurredAt: new Date().toISOString(),
        technicalId: `event-crawl-demo-${activity.length + 1}`,
        details: "The in-memory fixture repository changed; no external site was contacted.",
      };
      activity = [event, ...activity];
      return copy(event);
    },
  };
}
