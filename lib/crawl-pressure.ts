/** Backpressure for independent leased requests, never retry a source identity. */
export function crawlPressure(maximum: number) {
  const ceiling = Math.max(1, Math.min(12, Math.trunc(maximum)));
  let concurrency = Math.min(2, ceiling);
  let cleanRounds = 0;
  let errorRounds = 0;
  return {
    get concurrency() { return concurrency; },
    observe(errors: number) {
      if (errors > 0) {
        cleanRounds = 0;
        errorRounds += 1;
        concurrency = Math.max(1, Math.floor(concurrency / 2));
        return Math.min(30_000, 5_000 * 2 ** Math.min(errorRounds - 1, 3));
      }
      errorRounds = 0;
      if (++cleanRounds >= 3) {
        concurrency = Math.min(ceiling, concurrency + 1);
        cleanRounds = 0;
      }
      return 0;
    },
  };
}
