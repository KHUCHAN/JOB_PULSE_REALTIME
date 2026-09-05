import { crawlPressure } from "./crawl-pressure.ts";

/** Refill a free lease slot without waiting for unrelated slow companies. */
export async function drainCrawlPool<T extends { attempted: number }>(options: {
  crawl: () => Promise<T>;
  concurrency: number;
  deadline: number;
  recoverable: (error: unknown) => boolean;
  onResult: (result: T) => void;
  onError: (error: unknown) => void;
  onPressure?: (concurrency: number, cooldownMs: number) => void;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const pressure = crawlPressure(options.concurrency);
  type Completion = { id: number; result: T } | { id: number; error: unknown };
  const active = new Map<number, Promise<Completion>>();
  let requests = 0;
  let clean = 0;
  let consecutiveErrors = 0;
  let cooldownUntil = 0;
  let emptyObserved = false;
  let probing = false;
  let drained = false;
  let stopReason: string | null = null;
  let fatal: unknown;
  let fatalSeen = false;
  const launch = () => {
    const id = ++requests;
    active.set(id, Promise.resolve().then(options.crawl).then(
      result => ({ id, result }), error => ({ id, error }),
    ));
  };
  while (true) {
    const now = clock();
    if (!stopReason && now >= options.deadline) stopReason = "time-limit";
    if (!stopReason && active.size === 0 && emptyObserved) {
      // An empty lease response can mean all due sources are currently held
      // by our other requests. Probe again only after those leases finish.
      emptyObserved = false;
      probing = true;
    }
    if (!stopReason && !emptyObserved && now >= cooldownUntil) {
      const limit = probing ? 1 : pressure.concurrency;
      while (active.size < limit) launch();
    }
    if (active.size === 0) {
      if (stopReason) break;
      await sleep(Math.min(cooldownUntil - clock(), options.deadline - clock()));
      continue;
    }
    const completion = await Promise.race(active.values());
    active.delete(completion.id);
    if ("error" in completion) {
      options.onError(completion.error);
      clean = 0;
      consecutiveErrors += 1;
      const cooldownMs = pressure.observe(1);
      cooldownUntil = clock() + cooldownMs;
      options.onPressure?.(pressure.concurrency, cooldownMs);
      if (!options.recoverable(completion.error)) {
        fatal = completion.error;
        fatalSeen = true;
        stopReason = "fatal-request-error";
      } else if (consecutiveErrors >= 5) stopReason = "consecutive-request-errors";
    } else {
      options.onResult(completion.result);
      consecutiveErrors = 0;
      if (++clean >= pressure.concurrency) { pressure.observe(0); clean = 0; }
      if (completion.result.attempted === 0) {
        if (probing) { drained = true; stopReason = "queue-drained"; }
        else emptyObserved = true;
      } else if (probing) probing = false;
    }
    // Even on timeout/auth failure, settle every started request before the
    // owner finalizes runs or starts its next recovery lane. Never retry it.
  }
  if (fatalSeen) throw fatal;
  return { requests, drained, stopReason };
}
