import type {
  ActivityEvent,
  ActivityFilters,
  CreateKeywordInput,
  JobFilterOptions,
  JobFilters,
  JobSearchResult,
  JobPosting,
  JobState,
  KeywordRule,
  OverviewSnapshot,
  ResumeAlertStatus,
  ResumeTestEmailResult,
  SourceRecord,
  TalentState,
  TalentTarget,
} from "./domain";
import type { RichJobPosting } from "./pulse-mappers";

export type RichJobSearchResult = Omit<JobSearchResult, "items"> & {
  items: RichJobPosting[];
};

export interface JobPulseRepository {
  getOverview(): Promise<OverviewSnapshot>;
  searchJobs(filters?: Partial<JobFilters>): Promise<RichJobSearchResult>;
  getJobFilterOptions(): Promise<JobFilterOptions>;
  listJobs(filters?: Partial<JobFilters>): Promise<RichJobPosting[]>;
  getJob(jobId: string): Promise<RichJobPosting | null>;
  updateJobState(jobId: string, state: JobState): Promise<JobPosting>;
  listSources(health?: SourceRecord["health"] | "all"): Promise<SourceRecord[]>;
  listKeywords(): Promise<KeywordRule[]>;
  createKeyword(input: CreateKeywordInput): Promise<KeywordRule>;
  setKeywordEnabled(keywordId: string, enabled: boolean): Promise<KeywordRule>;
  listTalentTargets(state?: TalentState | "all"): Promise<TalentTarget[]>;
  updateTalentState(
    targetId: string,
    state: TalentState,
    blocker?: string | null,
  ): Promise<TalentTarget>;
  listActivity(filters?: Partial<ActivityFilters>): Promise<ActivityEvent[]>;
  simulateCrawl(): Promise<ActivityEvent>;
  getResumeAlertStatus(): Promise<ResumeAlertStatus>;
  setResumeAlertEnabled(enabled: boolean): Promise<ResumeAlertStatus>;
  sendResumeTestEmail(): Promise<ResumeTestEmailResult>;
  retryResumeAlert(): Promise<ResumeAlertStatus>;
}
