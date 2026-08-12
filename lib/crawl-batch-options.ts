export function crawlBatchOptions(requested: number | undefined): { limit: number; concurrency: number } {
  const limit = Math.max(1, Math.min(4, requested ?? 4));
  // A single 10k-job response plus its existing D1 snapshot can occupy most
  // of the Sites Worker heap. Keep sources sequential inside one request;
  // individual source adapters still parallelize their bounded HTTP pages.
  const concurrency = 1;
  return { limit, concurrency };
}

export function jobTopicBackfillLimit(requested: number | undefined): number {
  return Math.max(1, Math.min(500, requested ?? 250));
}

export function jobProgramBackfillLimit(requested: number | undefined): number {
  return Math.max(1, Math.min(5_000, requested ?? 5_000));
}

export function jobAreaRegionBackfillLimit(requested: number | undefined): number {
  const value = Number.isFinite(requested) ? Math.trunc(requested!) : 800;
  return Math.max(1, Math.min(800, value));
}

export function recrawlSourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean))]
    .slice(0, 4);
}
