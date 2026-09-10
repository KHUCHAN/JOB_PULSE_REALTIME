/** Use only for operations whose writes are safe to replay after an ambiguous commit. */
export const retryIdempotentD1 = async <T>(
  operation: () => Promise<T>,
  wait: (milliseconds: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Do not retry storage quotas, bad SQL, constraints, or generic timeouts.
      // These specific D1 reset/overload errors are transient. Keep the total
      // additional delay below two seconds and surface a persistent failure.
      const transient = /D1/i.test(message) && /(?:DB storage operation exceeded timeout|Internal error while starting up D1 DB storage|database is overloaded|DB reset because of a timeout)/i.test(message);
      if (!transient || attempt >= 2) throw error;
      await wait(250 * 2 ** attempt);
    }
  }
};
