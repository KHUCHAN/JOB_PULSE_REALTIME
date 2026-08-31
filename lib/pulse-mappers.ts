import type { ActivityEvent, JobAreaKey, JobPosting, JobRegion, SourceHealth } from "./domain";

export interface JobViewRow {
  id: string;
  source_id: string;
  company: string;
  title: string;
  location: string | null;
  arrangement: string;
  summary: string | null;
  official_url: string;
  first_seen_at: string;
  last_seen_at: string;
  review_state: string | null;
  employment_type?: string | null;
  description?: string | null;
  responsibilities?: string | null;
  qualifications?: string | null;
  skills?: string | null;
  department?: string | null;
  team?: string | null;
  business_unit?: string | null;
  job_family?: string | null;
  job_function?: string | null;
  industry?: string | null;
  office?: string | null;
  secondary_locations?: string | null;
  location_city?: string | null;
  location_state?: string | null;
  location_country?: string | null;
  location_region?: string | null;
  area_keys?: string | null;
  location_postal_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  salary_interval?: string | null;
  benefits?: string | null;
  education_requirements?: string | null;
  experience_requirements?: string | null;
  experience_level?: string | null;
  shift_schedule?: string | null;
  travel_requirements?: string | null;
  security_clearance?: string | null;
  languages?: string | null;
  requisition_id?: string | null;
  apply_url?: string | null;
  source_posted_text?: string | null;
  source_updated_at?: string | null;
  valid_through?: string | null;
  published_at?: string | null;
  resume_match_score?: number | null;
  resume_match_evidence?: string | null;
  resume_notified_at?: string | null;
  resume_review_decision?: string | null;
  resume_identity_already_notified?: number | null;
}

export interface RichJobPosting extends JobPosting {
  areaKeys: JobAreaKey[];
  locationRegion: JobRegion;
  employmentType: string | null;
  description: string | null;
  responsibilities: string | null;
  qualifications: string | null;
  skills: string[];
  department: string | null;
  team: string | null;
  businessUnit: string | null;
  jobFamily: string | null;
  jobFunction: string | null;
  industry: string | null;
  office: string | null;
  secondaryLocations: string[];
  locationCity: string | null;
  locationState: string | null;
  locationCountry: string | null;
  locationPostalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryInterval: string | null;
  benefits: string | null;
  educationRequirements: string | null;
  experienceRequirements: string | null;
  experienceLevel: string | null;
  shiftSchedule: string | null;
  travelRequirements: string | null;
  securityClearance: string | null;
  languages: string[];
  requisitionId: string | null;
  applyUrl: string | null;
  sourcePostedText: string | null;
  sourceUpdatedAt: string | null;
  validThrough: string | null;
  publishedAt: string | null;
  resumeMatchScore: number | null;
  resumeMatchEvidence: string[];
  resumeNotifiedAt: string | null;
  resumeReviewDecision: "approve" | "reject" | null;
  resumeIdentityAlreadyNotified: boolean;
}

const nullableText = (value: string | null | undefined): string | null => value?.trim() || null;

const jsonStringArray = (value: string | null | undefined): string[] => {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const jobAreaKeys = (value: string | null | undefined): JobAreaKey[] => {
  const allowed = new Set<JobAreaKey>(["ai-ml", "data-analytics", "software-engineering"]);
  return jsonStringArray(value).filter((item): item is JobAreaKey => allowed.has(item as JobAreaKey));
};

const jobRegion = (value: string | null | undefined): JobRegion =>
  ["us", "non_us", "mixed", "unknown"].includes(value ?? "") ? value as JobRegion : "unknown";

const resumeEvidenceLabels = (value: string | null | undefined): string[] => jsonStringArray(value)
  .map((item) => item.split("|")[1]?.trim() || item)
  .filter((item, index, values) => item && values.indexOf(item) === index);

export interface CrawlActivityRow {
  id: string;
  company: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  jobs_seen: number;
  jobs_created: number;
  jobs_updated: number;
  jobs_closed: number;
  error: string | null;
}

export function mapJob(row: JobViewRow): RichJobPosting {
  const arrangement = ["remote", "hybrid", "onsite"].includes(row.arrangement)
    ? row.arrangement as JobPosting["arrangement"]
    : "onsite";
  const status = ["new", "saved", "hidden", "applied"].includes(row.review_state ?? "")
    ? row.review_state as JobPosting["status"]
    : "new";
  const resumeMatchScore = row.resume_match_score ?? null;
  const resumeMatchEvidence = resumeEvidenceLabels(row.resume_match_evidence);
  return {
    id: row.id,
    sourceId: row.source_id,
    company: row.company,
    title: row.title,
    location: row.location || "Location not specified",
    arrangement,
    summary: row.summary || "Open the official posting for the full role description.",
    officialUrl: row.official_url,
    matchedTerms: resumeMatchEvidence,
    matchScore: resumeMatchScore ?? 0,
    firstSeenAt: row.first_seen_at,
    lastConfirmedAt: row.last_seen_at,
    status,
    areaKeys: jobAreaKeys(row.area_keys),
    locationRegion: jobRegion(row.location_region),
    employmentType: nullableText(row.employment_type),
    description: nullableText(row.description),
    responsibilities: nullableText(row.responsibilities),
    qualifications: nullableText(row.qualifications),
    skills: jsonStringArray(row.skills),
    department: nullableText(row.department),
    team: nullableText(row.team),
    businessUnit: nullableText(row.business_unit),
    jobFamily: nullableText(row.job_family),
    jobFunction: nullableText(row.job_function),
    industry: nullableText(row.industry),
    office: nullableText(row.office),
    secondaryLocations: jsonStringArray(row.secondary_locations),
    locationCity: nullableText(row.location_city),
    locationState: nullableText(row.location_state),
    locationCountry: nullableText(row.location_country),
    locationPostalCode: nullableText(row.location_postal_code),
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    salaryMin: row.salary_min ?? null,
    salaryMax: row.salary_max ?? null,
    salaryCurrency: nullableText(row.salary_currency),
    salaryInterval: nullableText(row.salary_interval),
    benefits: nullableText(row.benefits),
    educationRequirements: nullableText(row.education_requirements),
    experienceRequirements: nullableText(row.experience_requirements),
    experienceLevel: nullableText(row.experience_level),
    shiftSchedule: nullableText(row.shift_schedule),
    travelRequirements: nullableText(row.travel_requirements),
    securityClearance: nullableText(row.security_clearance),
    languages: jsonStringArray(row.languages),
    requisitionId: nullableText(row.requisition_id),
    applyUrl: nullableText(row.apply_url),
    sourcePostedText: nullableText(row.source_posted_text),
    sourceUpdatedAt: nullableText(row.source_updated_at),
    validThrough: nullableText(row.valid_through),
    publishedAt: nullableText(row.published_at),
    resumeMatchScore,
    resumeMatchEvidence,
    resumeNotifiedAt: nullableText(row.resume_notified_at),
    resumeReviewDecision: row.resume_review_decision === "approve" || row.resume_review_decision === "reject"
      ? row.resume_review_decision
      : null,
    resumeIdentityAlreadyNotified: row.resume_identity_already_notified === 1,
  };
}

export function utcTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? new Date(time).toISOString() : value;
}

export function sourceHealth(
  enabled: boolean,
  latestStatus: string | null,
  lastCheckedAt?: string | null,
  currentJobs?: number,
  now = new Date(),
): SourceHealth {
  if (!enabled) return "inactive";
  if (latestStatus === "blocked") return "blocked";
  if (latestStatus === "failed") return "failed";
  if (latestStatus === "succeeded") {
    const checkedAt = Date.parse(utcTimestamp(lastCheckedAt) ?? "");
    if (Number.isFinite(checkedAt) && now.getTime() - checkedAt > 6 * 60 * 60 * 1_000) return "stale";
    if (currentJobs === 0) return "empty";
    return "healthy";
  }
  return "changed";
}

export function mapCrawlActivity(row: CrawlActivityRow): ActivityEvent {
  const failed = row.status === "failed" || row.status === "blocked";
  return {
    id: row.id,
    kind: failed ? "source.failed" : "source.changed",
    severity: failed ? "error" : "success",
    summary: failed
      ? `${row.company} crawl ${row.status}.`
      : `${row.company} refreshed ${row.jobs_seen} roles.`,
    occurredAt: row.finished_at || row.started_at || new Date(0).toISOString(),
    technicalId: row.id,
    details: row.error || `${row.jobs_created} created, ${row.jobs_updated} updated, ${row.jobs_closed} closed.`,
  };
}
