export type JobState = "new" | "saved" | "hidden" | "applied";
export type WorkArrangement = "onsite" | "hybrid" | "remote";
export type JobProgramType = "internship" | "coop" | "regular";
export type JobSeason = "spring" | "summer" | "fall" | "winter";
export type JobTopicKey = "ai-data";
export type JobAreaKey = "ai-ml" | "data-analytics" | "software-engineering";
export type JobRegion = "us" | "non_us" | "mixed" | "unknown";
export type SourceHealth =
  | "healthy"
  | "changed"
  | "blocked"
  | "failed"
  | "inactive";
export type TalentState = "ready" | "in_progress" | "blocked" | "completed";
export type ActivityKind =
  | "crawl.demo"
  | "source.changed"
  | "source.failed"
  | "job.created"
  | "job.updated"
  | "job.closed"
  | "match.created"
  | "email.sent"
  | "email.failed"
  | "talent.updated";

export interface JobPosting {
  id: string;
  sourceId: string;
  company: string;
  title: string;
  location: string;
  arrangement: WorkArrangement;
  summary: string;
  officialUrl: string;
  matchedTerms: string[];
  matchScore: number;
  firstSeenAt: string;
  lastConfirmedAt: string;
  status: JobState;
}

export interface JobFilters {
  query: string;
  status: "all" | JobState;
  arrangement: "all" | WorkArrangement;
  location: string;
  topics?: JobTopicKey[];
  areas?: JobAreaKey[];
  regions?: JobRegion[];
  companies?: string[];
  cities?: string[];
  states?: string[];
  countries?: string[];
  employmentTypes?: string[];
  recruitingYears?: number[];
  programTypes?: JobProgramType[];
  seasons?: JobSeason[];
  postedAfter?: string;
  postedBefore?: string;
  departments?: string[];
  teams?: string[];
  businessUnits?: string[];
  jobFamilies?: string[];
  jobFunctions?: string[];
  industries?: string[];
  offices?: string[];
  skills?: string[];
  experienceLevels?: string[];
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrencies?: string[];
  salaryIntervals?: string[];
  educationRequirements?: string[];
  shiftSchedules?: string[];
  travelRequirements?: string[];
  securityClearances?: string[];
  languages?: string[];
  page?: number;
  pageSize?: number;
  resumeMatchProfile?: "chanyoung-resume";
}

export interface ResumeMatchSummary {
  score: number;
  evidence: string[];
}

export interface JobFilterOption {
  value: string | number;
  count: number;
}

export type JobFilterOptions = Record<
  | "companies"
  | "locations"
  | "cities"
  | "states"
  | "countries"
  | "regions"
  | "arrangements"
  | "employmentTypes"
  | "recruitingYears"
  | "programTypes"
  | "seasons"
  | "departments"
  | "teams"
  | "businessUnits"
  | "jobFamilies"
  | "jobFunctions"
  | "industries"
  | "offices"
  | "skills"
  | "experienceLevels"
  | "salaryCurrencies"
  | "salaryIntervals"
  | "educationRequirements"
  | "shiftSchedules"
  | "travelRequirements"
  | "securityClearances"
  | "languages",
  JobFilterOption[]
>;

export interface JobSearchResult {
  items: JobPosting[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SourceRecord {
  id: string;
  company: string;
  postingUrl: string | null;
  talentUrl: string | null;
  adapter: "greenhouse" | "lever" | "workday" | "ashby" | "icims" | "phenom" | "dayforce" | "smartrecruiters" | "custom";
  health: SourceHealth;
  httpStatus: number | null;
  lastError?: string | null;
  currentJobs: number;
  lastCheckedAt: string;
  lastChangedAt: string | null;
  nextRunAt: string | null;
}

export interface KeywordRule {
  id: string;
  name: string;
  includeTerms: string[];
  excludeTerms: string[];
  locations: string[];
  enabled: boolean;
  mode: "six_hour" | "daily_digest";
  lastSentAt: string | null;
}

export interface TalentTarget {
  id: string;
  company: string;
  ats: string;
  talentUrl: string;
  resumeUpload: "available" | "job_only" | "unknown";
  jobAlerts: "available" | "unknown";
  state: TalentState;
  blocker: string | null;
  lastAttemptAt: string | null;
}

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  severity: "info" | "success" | "warning" | "error";
  summary: string;
  occurredAt: string;
  technicalId: string;
  details: string;
}

export interface OverviewSnapshot {
  newMatches: number;
  activeSources: number;
  sourceErrors: number;
  unsentAlerts: number;
  openTalentTasks: number;
  latestJobs: JobPosting[];
  recentActivity: ActivityEvent[];
}

export interface ActivityFilters {
  severity: "all" | ActivityEvent["severity"];
  kind: "all" | ActivityKind;
}

export interface CreateKeywordInput {
  name: string;
  includeTerms: string[];
  excludeTerms: string[];
  locations: string[];
  mode: KeywordRule["mode"];
}

export interface ResumeAlertStatus {
  profileId: "chanyoung-resume";
  enabled: boolean;
  gmailState: "unconfigured" | "connected" | "blocked";
  sender: string;
  recipients: string[];
  queuedJobs: number;
  lastDigestAt: string | null;
  nextDigestAt: string | null;
  lastError: string | null;
}

export interface ResumeTestEmailResult {
  sent: number;
  failed: number;
}
