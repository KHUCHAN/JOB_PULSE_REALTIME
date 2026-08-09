export function crawlBatchOptions(requested: number | undefined): { limit: number; concurrency: number } {
  const limit = Math.max(1, Math.min(64, requested ?? 16));
  const concurrency = limit <= 4 ? limit : Math.min(16, Math.max(8, Math.ceil(limit / 4)));
  return { limit, concurrency };
}
