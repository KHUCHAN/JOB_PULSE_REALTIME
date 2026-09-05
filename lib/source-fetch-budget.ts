/** One deadline across all catalog pages and retry attempts, not per request. */
export function sourceFetchBudget(timeoutMs: number, fetcher: typeof fetch = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(
    `Source fetch budget exceeded ${timeoutMs} ms; deferred to next owner run.`,
  )), timeoutMs);
  const check = () => controller.signal.throwIfAborted();
  const boundedFetch: typeof fetch = (input, init) => {
    check();
    const signals = [controller.signal];
    if (input instanceof Request) signals.push(input.signal);
    if (init?.signal) signals.push(init.signal);
    return fetcher(input, { ...init, signal: AbortSignal.any(signals) });
  };
  return { fetch: boundedFetch, check, dispose: () => clearTimeout(timer) };
}
