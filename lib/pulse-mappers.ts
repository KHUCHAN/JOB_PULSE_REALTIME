import type { ActivityEvent, JobPosting, SourceHealth } from "./domain";

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
}

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

export function mapJob(row: JobViewRow): JobPosting {
  const arrangement = ["remote", "hybrid", "onsite"].includes(row.arrangement)
    ? row.arrangement as JobPosting["arrangement"]
    : "onsite";
  const status = ["new", "saved", "hidden", "applied"].includes(row.review_state ?? "")
    ? row.review_state as JobPosting["status"]
    : "new";
  return {
    id: row.id,
    sourceId: row.source_id,
    company: row.company,
    title: row.title,
    location: row.location || "Location not specified",
    arrangement,
    summary: row.summary || "Open the official posting for the full role description.",
    officialUrl: row.official_url,
    matchedTerms: [],
    matchScore: 0,
    firstSeenAt: row.first_seen_at,
    lastConfirmedAt: row.last_seen_at,
    status,
  };
}

export function sourceHealth(enabled: boolean, latestStatus: string | null): SourceHealth {
  if (!enabled) return "inactive";
  if (latestStatus === "blocked") return "blocked";
  if (latestStatus === "failed") return "failed";
  if (latestStatus === "succeeded") return "healthy";
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
