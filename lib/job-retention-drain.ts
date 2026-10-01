/** Bounded maintenance only. Never starts a crawler or dispatches email. */
export async function drainExpiredJobs(
  purge: () => Promise<{ deleted: number; hasMore: boolean }>,
  clock: () => number = Date.now,
  budgetMs = 120_000,
  onProgress?: (progress: { deleted: number; batches: number; hasMore: boolean }) => void,
  options: { maximumBatches?: number; pauseMs?: number; sleep?: (ms: number) => Promise<void> } = {},
) {
  const maximumBatches = options.maximumBatches ?? 10;
  const pauseMs = options.pauseMs ?? 0;
  if (!Number.isInteger(maximumBatches) || maximumBatches < 1 || maximumBatches > 100
    || !Number.isInteger(pauseMs) || pauseMs < 0 || pauseMs > 10_000) {
    throw new Error("Invalid retention drain limits.");
  }
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const deadline = clock() + budgetMs;
  let deleted = 0;
  let batches = 0;
  let hasMore = true;
  // A time limit alone allowed 23,300 deletes in 100 seconds on production.
  // Keep a strict write ceiling and optionally pace the idle owner lane.
  // The production owner allows 100 sequential chunks within the same budget;
  // other callers retain the legacy 10-chunk default.
  while (clock() + 20_000 < deadline && batches < maximumBatches) {
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
    if (batches < maximumBatches && pauseMs > 0) {
      if (clock() + pauseMs + 20_000 >= deadline) break;
      await sleep(pauseMs);
    }
  }
  return { deleted, batches, hasMore };
}
