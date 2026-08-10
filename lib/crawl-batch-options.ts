export function crawlBatchOptions(requested: number | undefined): { limit: number; concurrency: number } {
  const limit = Math.max(1, Math.min(4, requested ?? 4));
  const concurrency = Math.min(2, limit);
  return { limit, concurrency };
}

export function recrawlSourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean))]
    .slice(0, 4);
}
