export type JobState = "new" | "saved" | "hidden" | "applied";
export type WorkArrangement = "onsite" | "hybrid" | "remote";
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
}

export interface SourceRecord {
  id: string;
  company: string;
  postingUrl: string | null;
  talentUrl: string | null;
  adapter: "greenhouse" | "lever" | "workday" | "ashby" | "icims" | "phenom" | "custom";
  health: SourceHealth;
  httpStatus: number | null;
  currentJobs: number;
  lastCheckedAt: string;
  lastChangedAt: string | null;
  nextRunAt: string;
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
