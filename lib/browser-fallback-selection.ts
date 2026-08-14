export type LatestCrawlSummary = {
  status: "running" | "succeeded" | "failed" | "blocked" | null;
  jobsSeen: number | null;
};

export const needsBrowserFallback = ({ status, jobsSeen }: LatestCrawlSummary, force = false): boolean => (
  force || status === null || status === "blocked" || status === "failed" || (status === "succeeded" && jobsSeen === 0)
);

/**
 * Browser recovery is a weaker, best-effort observation than a completed
 * native crawl. A browser challenge, timeout, or unrendered shell must not
 * replace a successful authoritative result in source health.
 */
export const shouldRecordBrowserResult = (
  previousStatus: LatestCrawlSummary["status"],
  browserStatus: Exclude<LatestCrawlSummary["status"], "running" | null>,
): boolean => browserStatus === "succeeded" || previousStatus !== "succeeded";
