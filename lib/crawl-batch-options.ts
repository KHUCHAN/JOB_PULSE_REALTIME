export function crawlBatchOptions(requested: number | undefined): { limit: number; concurrency: number } {
  const limit = Math.max(1, Math.min(8, requested ?? 8));
  const concurrency = Math.min(4, limit);
  return { limit, concurrency };
}
