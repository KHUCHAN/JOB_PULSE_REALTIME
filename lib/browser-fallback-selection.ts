export type LatestCrawlSummary = {
  status: "running" | "succeeded" | "failed" | "blocked" | null;
  jobsSeen: number | null;
};

export const needsBrowserFallback = ({ status, jobsSeen }: LatestCrawlSummary, force = false): boolean => (
  force || status === null || status === "blocked" || status === "failed" || (status === "succeeded" && jobsSeen === 0)
);

export type BrowserRecoveryQueueSource = {
  health: string;
  currentJobs: number;
  lastCheckedAt: string | null;
  nextRunAt: string | null;
};

export const browserRecoveryDue = (
  source: BrowserRecoveryQueueSource,
  now = Date.now(),
): boolean => {
  const problem = source.health === "failed" || source.health === "blocked"
    || source.health === "inactive" || (source.health === "healthy" && source.currentJobs === 0);
  if (!problem) return false;
  const next = Date.parse(source.nextRunAt ?? "");
  if (!Number.isFinite(next) || next <= now) return true;
  const checked = Date.parse(source.lastCheckedAt ?? "");
  // Native failures are immediately assigned a 6h/24h backoff. The browser
  // job runs directly after that native drain, so admit newly checked failures
  // even though their next-run timestamp is in the future.
  return Number.isFinite(checked) && checked <= now + 5 * 60_000 && checked >= now - 45 * 60_000;
};

/**
 * Browser recovery is a weaker, best-effort observation than a completed
 * native crawl. A positive recovery may supersede a native result, and a
 * verified browser challenge may refine a generic native failure to blocked.
 * A challenge, timeout, or unrendered shell must never erase a success.
 */
export const shouldRecordBrowserResult = (
  previousStatus: LatestCrawlSummary["status"],
  browserStatus: Exclude<LatestCrawlSummary["status"], "running" | null>,
): boolean => browserStatus === "succeeded"
  || (browserStatus === "blocked" && previousStatus === "failed")
  || previousStatus === null;

export const browserResultError = (
  status: Exclude<LatestCrawlSummary["status"], "running" | null>,
  code: string,
): string | null => status === "succeeded" ? null : code;
