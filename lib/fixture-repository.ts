import type {
  ActivityEvent,
  ActivityFilters,
  CreateKeywordInput,
  JobFilters,
  JobState,
  KeywordRule,
  SourceRecord,
  TalentState,
} from "./domain";
import {
  fixtureActivity,
  fixtureJobs,
  fixtureKeywords,
  fixtureSources,
  fixtureTalentTargets,
} from "./fixtures";
import type { JobPulseRepository } from "./repository";

const defaultFilters: JobFilters = {
  query: "",
  status: "all",
  arrangement: "all",
  location: "",
};

const copy = <T>(value: T): T => structuredClone(value);

export function createFixtureRepository(): JobPulseRepository {
  const jobs = copy(fixtureJobs);
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

    async listJobs(filters = {}) {
      const merged = { ...defaultFilters, ...filters };
      const query = merged.query.trim().toLowerCase();
      const location = merged.location.trim().toLowerCase();

      return copy(
        jobs.filter((job) => {
          const searchable = [
            job.company,
            job.title,
            job.summary,
            job.location,
            ...job.matchedTerms,
          ]
            .join(" ")
            .toLowerCase();
          return (
            (!query || searchable.includes(query)) &&
            (merged.status === "all" || job.status === merged.status) &&
            (merged.arrangement === "all" || job.arrangement === merged.arrangement) &&
            (!location || job.location.toLowerCase().includes(location))
          );
        }),
      );
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
