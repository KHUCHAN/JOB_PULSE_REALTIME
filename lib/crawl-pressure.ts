/** Backpressure for independent leased requests, never retry a source identity. */
export function crawlPressure(maximum: number, clock: () => number = Date.now) {
  const ceiling = Math.max(1, Math.min(12, Math.trunc(maximum)));
  let concurrency = Math.min(2, ceiling);
  let cleanRounds = 0;
  let errorRounds = 0;
  // Fast/empty boards are not evidence that D1's write queue has recovered.
  // Previously three quick completions could undo a backoff in milliseconds,
  // causing another wave of 45-second queue failures. Require elapsed healthy
  // time as well as clean rounds, without stopping work at the reduced limit.
  let increaseAfter = clock() + 30_000;
  return {
    get concurrency() { return concurrency; },
    observe(errors: number) {
      if (errors > 0) {
        cleanRounds = 0;
        errorRounds += 1;
        concurrency = Math.max(1, Math.floor(concurrency / 2));
        increaseAfter = clock() + 60_000;
        return Math.min(30_000, 5_000 * 2 ** Math.min(errorRounds - 1, 3));
      }
      cleanRounds = Math.min(3, cleanRounds + 1);
      if (cleanRounds >= 3 && clock() >= increaseAfter) {
        concurrency = Math.min(ceiling, concurrency + 1);
        cleanRounds = 0;
        errorRounds = 0;
        increaseAfter = clock() + 30_000;
      }
      return 0;
    },
  };
}
