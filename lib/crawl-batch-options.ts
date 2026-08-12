export function crawlBatchOptions(requested: number | undefined): { limit: number; concurrency: number } {
  // Keep each HTTP invocation isolated to one source. The scheduler may run
  // two requests concurrently, while a single large catalog can no longer
  // retain memory or delay the remaining leases in the same Worker request.
  const limit = 1;
  const concurrency = 1;
  void requested;
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
