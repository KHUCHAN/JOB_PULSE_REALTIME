/** Bounded maintenance only. Never starts a crawler or dispatches email. */
export async function drainExpiredJobs(
  purge: () => Promise<{ deleted: number; hasMore: boolean }>,
  clock: () => number = Date.now,
  budgetMs = 120_000,
  onProgress?: (progress: { deleted: number; batches: number; hasMore: boolean }) => void,
) {
  const deadline = clock() + budgetMs;
  let deleted = 0;
  let batches = 0;
  let hasMore = true;
  while (clock() + 20_000 < deadline && batches < 500) {
    const result = await purge();
    if (!Number.isInteger(result.deleted) || result.deleted < 0 || result.deleted > 100 || typeof result.hasMore !== "boolean") {
      throw new Error("Invalid retention response.");
    }
    deleted += result.deleted;
    batches += 1;
    hasMore = result.hasMore;
    onProgress?.({ deleted, batches, hasMore });
    if (!hasMore) break;
    if (result.deleted === 0) throw new Error("Retention made no progress with a remaining backlog.");
  }
  return { deleted, batches, hasMore };
}
