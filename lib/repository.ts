import type {
  ActivityEvent,
  ActivityFilters,
  CreateKeywordInput,
  JobFilters,
  JobPosting,
  JobState,
  KeywordRule,
  OverviewSnapshot,
  SourceRecord,
  TalentState,
  TalentTarget,
} from "./domain";

export interface JobPulseRepository {
  getOverview(): Promise<OverviewSnapshot>;
  listJobs(filters?: Partial<JobFilters>): Promise<JobPosting[]>;
  getJob(jobId: string): Promise<JobPosting | null>;
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
}
