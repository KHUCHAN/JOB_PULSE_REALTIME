import { createFifoLimiter } from "./fifo-limiter.ts";

export type SnapshotWriteTiming = { waitMs: number; writeMs: number; requests: number };

/** Share capacity per HTTP chunk, including response-body consumption. */
export const createSnapshotWriter = (concurrency: number, fetcher: typeof fetch = fetch) => {
  const lease = createFifoLimiter(concurrency);
  return (timing?: SnapshotWriteTiming): typeof fetch => async (input, init) => {
    const queuedAt = Date.now();
    return lease(async () => {
      const startedAt = Date.now();
      if (timing) timing.waitMs += startedAt - queuedAt;
      try {
        init?.signal?.throwIfAborted();
        const response = await fetcher(input, init);
        const body = await response.arrayBuffer();
        return new Response([204, 205, 304].includes(response.status) ? null : body, {
          status: response.status, statusText: response.statusText, headers: response.headers,
        });
      } finally {
        if (timing) { timing.writeMs += Date.now() - startedAt; timing.requests += 1; }
      }
    });
  };
};
