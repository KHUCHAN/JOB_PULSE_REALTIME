import type {
  ActivityFilters,
  CreateKeywordInput,
  JobFilters,
  JobPosting,
  JobState,
  SourceRecord,
  TalentState,
} from "./domain";
import type { JobPulseRepository } from "./repository";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || `Job Pulse API returned ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

const query = (resource: string, values: Record<string, string | undefined> = {}): string => {
  const params = new URLSearchParams({ resource });
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "" && value !== "all") params.set(key, value);
  }
  return `/api/pulse?${params.toString()}`;
};

const mutate = <T>(action: string, payload: Record<string, unknown>): Promise<T> =>
  request<T>("/api/pulse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });

export function createApiRepository(): JobPulseRepository {
  return {
    getOverview: () => request(query("overview")),
    listJobs: (filters: Partial<JobFilters> = {}) => request(query("jobs", {
      q: filters.query,
      status: filters.status,
      arrangement: filters.arrangement,
      location: filters.location,
    })),
    getJob: (jobId: string) => request(query("job", { id: jobId })),
    updateJobState: (jobId: string, state: JobState) =>
      mutate<JobPosting>("updateJobState", { jobId, state }),
    listSources: (health: SourceRecord["health"] | "all" = "all") =>
      request(query("sources", { health })),
    listKeywords: () => request(query("keywords")),
    createKeyword: (input: CreateKeywordInput) => mutate("createKeyword", { input }),
    setKeywordEnabled: (keywordId: string, enabled: boolean) =>
      mutate("setKeywordEnabled", { keywordId, enabled }),
    listTalentTargets: (state: TalentState | "all" = "all") =>
      request(query("talent", { state })),
    updateTalentState: (targetId: string, state: TalentState, blocker: string | null = null) =>
      mutate("updateTalentState", { targetId, state, blocker }),
    listActivity: (filters: Partial<ActivityFilters> = {}) => request(query("activity", {
      severity: filters.severity,
      kind: filters.kind,
    })),
    simulateCrawl: () => mutate("crawlBatch", { limit: 8 }),
  };
}
