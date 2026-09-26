type InventoryOptions = {
  attempts?: number;
  timeoutMs?: number;
  delayMs?: number;
  fetcher?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
};

class PermanentInventoryError extends Error {}

// AbortSignal.timeout rejects with a DOMException, which is not an Error in
// every runtime; read its message directly.
const errorMessage = (error: unknown, fallback: string): string =>
  typeof (error as { message?: unknown })?.message === "string" ? (error as { message: string }).message : fallback;

/**
 * Read one bounded live source window. The endpoint normally answers in under
 * a second, but D1 queues every request while a long drain holds the writer;
 * a single 30-second miss used to abort the whole critical-employer lane
 * before any catalog was fetched. Retry timeouts, network errors, 429 and
 * 5xx with a growing pause; a 4xx is a real contract error and fails at once.
 */
export const fetchLiveSourceInventory = async <T = unknown>(url: string, options: InventoryOptions = {}): Promise<T[]> => {
  const attempts = Math.max(1, options.attempts ?? 4);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const delayMs = options.delayMs ?? 5_000;
  const fetcher = options.fetcher ?? fetch;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        const message = `Live source inventory returned HTTP ${response.status}.`;
        if (response.status !== 429 && response.status < 500) throw new PermanentInventoryError(message);
        throw new Error(message);
      }
      const body = await response.json() as unknown;
      if (!Array.isArray(body)) throw new PermanentInventoryError("Live source inventory response was not a source list.");
      return body as T[];
    } catch (error) {
      if (error instanceof PermanentInventoryError) throw error;
      lastError = error;
      if (attempt < attempts) await wait(delayMs * attempt);
    }
  }
  throw new Error(`Live source inventory unavailable after ${attempts} attempts: ${errorMessage(lastError, String(lastError))}`);
};

/**
 * Evidence for a lane that could not even load its inventory. Every requested
 * company is explicitly failed so browser recovery and the final reconcile see
 * the outage instead of crashing on a missing results file.
 */
export const inventoryFailureHandoff = (sourceIds: string[], error: unknown) => {
  const message = errorMessage(error, "Live source inventory was unavailable.");
  const summaries = [...new Set(sourceIds)].map((sourceId) => ({
    sourceId, status: "failed" as const, jobs: 0, created: 0, updated: 0, elapsedMs: 0, error: message,
  }));
  return { attempted: summaries.length, summaries };
};
