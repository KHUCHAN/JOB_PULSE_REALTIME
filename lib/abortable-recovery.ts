/** Bound a recovery stage and cancel its I/O before moving on to the browser. */
export async function abortableRecovery<T>(
  run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  signal.throwIfAborted();
  const timer = setTimeout(() => controller.abort(new Error("Recovery stage deadline exceeded.")), timeoutMs);
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([cancelled, run(signal)]); }
  finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    // No orphaned requests, even if a provider/parser returned early.
    controller.abort();
  }
}

export const recoveryFetch = (fetcher: typeof fetch, signal: AbortSignal): typeof fetch => (input, init) => {
  signal.throwIfAborted();
  return fetcher(input, { ...init, signal: AbortSignal.any([
    signal, ...(input instanceof Request ? [input.signal] : []), ...(init?.signal ? [init.signal] : []),
  ]) });
};
