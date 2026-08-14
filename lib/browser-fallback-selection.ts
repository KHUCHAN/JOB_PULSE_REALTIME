export type LatestCrawlSummary = {
  status: "running" | "succeeded" | "failed" | "blocked" | null;
  jobsSeen: number | null;
};

export const needsBrowserFallback = ({ status, jobsSeen }: LatestCrawlSummary, force = false): boolean => (
  force || status === null || status === "blocked" || status === "failed" || (status === "succeeded" && jobsSeen === 0)
);

/**
 * Browser recovery is a weaker, best-effort observation than a completed
 * native crawl. Only a positive browser recovery may supersede a native
 * result; a challenge, timeout, or unrendered shell must not erase either a
 * successful result or the native adapter's more actionable failure reason.
 */
export const shouldRecordBrowserResult = (
  previousStatus: LatestCrawlSummary["status"],
  browserStatus: Exclude<LatestCrawlSummary["status"], "running" | null>,
): boolean => browserStatus === "succeeded" || previousStatus === null;
