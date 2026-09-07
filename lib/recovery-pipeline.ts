import { createFifoLimiter } from "./fifo-limiter.ts";

/** Bound both upstream work and resident catalogs; transport has its own cap. */
export async function runRecoveryPipeline<T, C, R>(items: T[], options: {
  concurrency: number;
  pendingLimit: number;
  collect: (item: T) => Promise<C>;
  persist: (item: T, catalog: C) => Promise<R>;
  failed: (item: T, error: unknown) => R;
  onResult?: (result: R) => void;
}): Promise<R[]> {
  if (!Number.isInteger(options.pendingLimit) || options.pendingLimit < options.concurrency) {
    throw new Error("Invalid recovery pending limit");
  }
  const withFetchSlot = createFifoLimiter(options.concurrency);
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(options.pendingLimit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      try {
        // Start collection deadlines inside this lease, not while queued.
        const catalog = await withFetchSlot(() => options.collect(item));
        results[index] = await options.persist(item, catalog);
      } catch (error) {
        results[index] = options.failed(item, error);
      }
      options.onResult?.(results[index]);
    }
  }));
  return results;
}
