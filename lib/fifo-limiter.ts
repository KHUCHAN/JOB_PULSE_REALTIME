/** FIFO leases: callers must lease one bounded chunk, not a whole catalog. */
export const createFifoLimiter = (concurrency: number) => {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Invalid concurrency");
  let active = 0;
  const waiters: Array<() => void> = [];
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    if (active < concurrency) active += 1;
    else await new Promise<void>((resolve) => waiters.push(resolve));
    try {
      return await operation();
    } finally {
      const next = waiters.shift();
      if (next) next();
      else active -= 1;
    }
  };
};
