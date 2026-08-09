export type LatestCrawlSummary = {
  status: "running" | "succeeded" | "failed" | "blocked" | null;
  jobsSeen: number | null;
};

export const needsBrowserFallback = ({ status, jobsSeen }: LatestCrawlSummary, force = false): boolean => (
  force || status === null || status === "blocked" || status === "failed" || (status === "succeeded" && jobsSeen === 0)
);
