import type { CrawledFacet, CrawledJob, CrawlSource } from "./crawler";
import { inferEmploymentTypeFromPrograms, isCoopEmploymentType, normalizeEmploymentType } from "./employment-type";
import { classifyJobPrograms } from "./job-program-classifier";

type BrowserJobRecord = {
  externalId?: unknown;
  officialUrl?: unknown;
  applyUrl?: unknown;
  title?: unknown;
  location?: unknown;
  locationCity?: unknown;
  locationState?: unknown;
  locationCountry?: unknown;
  secondaryLocations?: unknown;
  arrangement?: unknown;
  publishedText?: unknown;
  publishedAt?: unknown;
  sourcePostedText?: unknown;
  sourceUpdatedAt?: unknown;
  validThrough?: unknown;
  summary?: unknown;
  description?: unknown;
  responsibilities?: unknown;
  qualifications?: unknown;
  skills?: unknown;
  businessUnit?: unknown;
  category?: unknown;
  companyId?: unknown;
  department?: unknown;
  team?: unknown;
  jobFamily?: unknown;
  jobFunction?: unknown;
  requisitionId?: unknown;
  jobRequisitionType?: unknown;
  employmentType?: unknown;
  postingType?: unknown;
  region?: unknown;
};

const textValue = (value: unknown, max = 500): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
};

const NON_JOB_TITLE = /^(?:privacy notice|create (?:an? )?(?:job )?alert|share your information|get in touch!?|join (?:our )?talent (?:community|network)|candidate (?:pool|profile)|sign in|log in|view profile|apply now)$/i;

const dateFromCard = (value: string | null): string | null => {
  if (!value) return null;
  const text = value.replace(/^Date Posted:\s*/i, "").trim();
  const timestamp = Date.parse(/(?:Z|[+-]\d{2}:?\d{2}|\bUTC)$/i.test(text) ? text : `${text} UTC`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const stringValues = (value: unknown, limit = 100): string[] => Array.isArray(value)
  ? [...new Set(value.slice(0, limit).flatMap((item) => textValue(item) ?? []))]
  : [];

const arrangementValue = (value: unknown, location: string | null): CrawledJob["arrangement"] => {
  const text = textValue(value, 20)?.toLocaleLowerCase();
  if (text === "onsite" || text === "hybrid" || text === "remote" || text === "unknown") return text;
  return /\bremote\b/i.test(location ?? "") ? "remote" : "unknown";
};

const countedFacet = (key: string, label: string, values: Array<string | null>): CrawledFacet | null => {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  if (counts.size === 0) return null;
  return {
    key,
    label,
    values: [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([value, count]) => ({ key: value, label: value, count })),
  };
};

export function normalizeBrowserJobSnapshot(
  source: CrawlSource,
  input: unknown,
  allowedOrigins?: string[],
): { jobs: CrawledJob[]; facets: CrawledFacet[] } {
  const sourcePath = new URL(source.postingUrl).pathname;
  const avatureListing = /\/careers\/SearchJobs\/?$/i.test(sourcePath);
  const officialOrigins = new Set([new URL(source.postingUrl).origin, ...(allowedOrigins ?? [])].flatMap((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? [url.origin] : [];
    } catch {
      return [];
    }
  }));
  if (!Array.isArray(input) || input.length > 10_000) throw new Error("Browser snapshot must contain at most 10,000 jobs.");

  const jobs = new Map<string, CrawledJob>();
  const regions: Array<string | null> = [];
  const businessUnits: Array<string | null> = [];
  const employmentTypes: Array<string | null> = [];
  for (const raw of input as BrowserJobRecord[]) {
    const title = textValue(raw?.title);
    const officialUrlText = textValue(raw?.officialUrl, 2_000);
    if (!title || !officialUrlText || NON_JOB_TITLE.test(title)) continue;
    let officialUrl: URL;
    try {
      officialUrl = new URL(officialUrlText);
    } catch {
      throw new Error("Browser job URL is invalid.");
    }
    if (officialUrl.protocol !== "https:" || officialUrl.username || officialUrl.password
      || !officialOrigins.has(officialUrl.origin)) {
      throw new Error("Browser job URL is outside the official careers origin.");
    }
    if (avatureListing && !/\/careers\/JobDetail\//i.test(officialUrl.pathname)) continue;
    const externalId = textValue(raw.externalId, 200)
      ?? officialUrl.pathname.match(/\/jobs\/(\d+)/i)?.[1]
      ?? officialUrl.pathname.match(/\/JobDetail\/[^/]+\/([^/?#]+)/i)?.[1]
      ?? officialUrl.pathname.match(/\/jobs?\/([^/?#]+)/i)?.[1]
      ?? officialUrl.searchParams.get("jobid")
      ?? officialUrl.searchParams.get("jobId")
      ?? null;
    const location = textValue(raw.location)?.replace(/^Location:\s*/i, "") ?? null;
    const locationCity = textValue(raw.locationCity);
    const locationState = textValue(raw.locationState);
    const locationCountry = textValue(raw.locationCountry);
    const secondaryLocations = stringValues(raw.secondaryLocations);
    const region = textValue(raw.region);
    const businessUnit = textValue(raw.businessUnit);
    const department = textValue(raw.department) ?? businessUnit;
    const titlePrograms = classifyJobPrograms(title).keys;
    const employmentType = isCoopEmploymentType(raw.employmentType) || titlePrograms.includes("coop")
      ? "Co-op"
      : normalizeEmploymentType(raw.employmentType)
      ?? inferEmploymentTypeFromPrograms(titlePrograms)
      ?? (/\b(?:trainee|industrial placement)\b/i.test(title) ? "Internship" : null);
    const jobRequisitionType = textValue(raw.jobRequisitionType);
    const category = textValue(raw.category);
    const postingType = textValue(raw.postingType);
    const jobFamily = textValue(raw.jobFamily) ?? region;
    const summary = textValue(raw.summary, 4_000)
      ?? ([employmentType, department, region, jobRequisitionType].filter(Boolean).join(" · ") || null);
    const applyUrlText = textValue(raw.applyUrl, 2_000);
    let applyUrl: string | null = null;
    if (applyUrlText) {
      const candidate = new URL(applyUrlText);
      if (candidate.protocol !== "https:" || candidate.username || candidate.password
        || !officialOrigins.has(candidate.origin)) throw new Error("Browser apply URL is outside the official careers origin.");
      applyUrl = candidate.href;
    }
    const sourcePostedText = textValue(raw.sourcePostedText, 500) ?? textValue(raw.publishedText, 500);
    jobs.set(officialUrl.href, {
      externalId,
      title,
      company: source.company,
      location,
      arrangement: arrangementValue(raw.arrangement, location),
      employmentType,
      summary,
      description: textValue(raw.description, 100_000),
      responsibilities: textValue(raw.responsibilities, 40_000),
      qualifications: textValue(raw.qualifications, 40_000),
      skills: stringValues(raw.skills),
      ...(department ? { department } : {}),
      ...(textValue(raw.team) ? { team: textValue(raw.team) } : {}),
      ...(businessUnit ? { businessUnit } : {}),
      ...(jobFamily ? { jobFamily } : {}),
      ...(textValue(raw.jobFunction) ? { jobFunction: textValue(raw.jobFunction) } : {}),
      ...(secondaryLocations.length > 0 ? { secondaryLocations } : {}),
      ...(locationCity ? { locationCity } : {}),
      ...(locationState ? { locationState } : {}),
      ...(locationCountry ? { locationCountry } : {}),
      ...(textValue(raw.requisitionId, 200) ? { requisitionId: textValue(raw.requisitionId, 200) } : {}),
      ...(applyUrl ? { applyUrl } : {}),
      ...(sourcePostedText ? { sourcePostedText } : {}),
      ...(dateFromCard(textValue(raw.sourceUpdatedAt, 200)) ? { sourceUpdatedAt: dateFromCard(textValue(raw.sourceUpdatedAt, 200)) } : {}),
      ...(dateFromCard(textValue(raw.validThrough, 200)) ? { validThrough: dateFromCard(textValue(raw.validThrough, 200)) } : {}),
      rawPayload: {
        ...(category ? { category } : {}),
        ...(jobRequisitionType ? { jobRequisitionType } : {}),
        ...(postingType ? { postingType } : {}),
        ...(textValue(raw.companyId) ? { companyId: textValue(raw.companyId) } : {}),
      },
      officialUrl: officialUrl.href,
      publishedAt: dateFromCard(textValue(raw.publishedAt, 200)) ?? dateFromCard(textValue(raw.publishedText)),
    });
    regions.push(region);
    businessUnits.push(businessUnit);
    employmentTypes.push(employmentType);
  }
  const facets = [
    countedFacet("employment_type", "Employment type", employmentTypes),
    countedFacet("region", "Region", regions),
    countedFacet("business_unit", "Business unit", businessUnits),
  ].filter((facet): facet is CrawledFacet => facet !== null);
  return { jobs: [...jobs.values()], facets };
}
