import { createFifoLimiter } from "./fifo-limiter.ts";
import type { SnapshotFetch } from "./job-snapshot-transport";

export type SnapshotWriteTiming = { waitMs: number; writeMs: number; requests: number };

/** Share capacity per HTTP chunk, including response-body consumption. */
export const createSnapshotWriter = (concurrency: number, fetcher: typeof fetch = fetch) => {
  const lease = createFifoLimiter(concurrency);
  let cooldownUntil = 0;
  return (timing?: SnapshotWriteTiming): SnapshotFetch => async (input, init) => {
    const queuedAt = Date.now();
    return lease(async () => {
      while (Date.now() < cooldownUntil) {
        init?.signal?.throwIfAborted();
        await new Promise(resolve => setTimeout(resolve, cooldownUntil - Date.now()));
      }
      const startedAt = Date.now();
      if (timing) timing.waitMs += startedAt - queuedAt;
      try {
        init?.signal?.throwIfAborted();
        const { requestTimeoutMs, ...request } = init ?? {};
        const timeout = requestTimeoutMs ? AbortSignal.timeout(requestTimeoutMs) : null;
        const signal = timeout && request.signal ? AbortSignal.any([timeout, request.signal]) : timeout ?? request.signal;
        const response = await fetcher(input, { ...request, signal });
        const body = await response.arrayBuffer();
        if ([408, 425, 429].includes(response.status) || response.status >= 500) {
          const retryAfter = Number(response.headers.get("retry-after")) * 1_000;
          cooldownUntil = Math.max(cooldownUntil, Date.now() + Math.min(30_000, Math.max(5_000, retryAfter || 0)));
        }
        return new Response([204, 205, 304].includes(response.status) ? null : body, {
          status: response.status, statusText: response.statusText, headers: response.headers,
        });
      } catch (error) {
        // Cool all queued sources, not just the failed company's retry. Never
        // replay here; transport alone owns bounded snapshot retries.
        cooldownUntil = Math.max(cooldownUntil, Date.now() + 5_000);
        throw error;
      } finally {
        if (timing) { timing.writeMs += Date.now() - startedAt; timing.requests += 1; }
      }
    });
  };
};
