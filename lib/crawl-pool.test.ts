import { afterEach, describe, expect, it, vi } from "vitest";
import { drainCrawlPool } from "./crawl-pool";

afterEach(() => vi.useRealTimers());
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe("continuous leased crawl pool", () => {
  it("refills fast slots while a slow company is running, with the same concurrency cap", async () => {
    vi.useFakeTimers();
    let running = 0; let maximum = 0; let calls = 0;
    const starts: number[] = [];
    const start = Date.now();
    const promise = drainCrawlPool({
      concurrency: 2, deadline: start + 1_000,
      crawl: async () => {
        const index = calls++;
        starts.push(Date.now() - start);
        maximum = Math.max(maximum, ++running);
        await pause(index === 0 ? 100 : 10);
        running--;
        return { attempted: index < 6 ? 1 : 0 };
      }, recoverable: () => true, onResult: vi.fn(), onError: vi.fn(),
    });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(maximum).toBe(2);
    expect(starts.slice(0, 6)).toEqual([0, 0, 10, 20, 30, 40]);
    expect(result.drained).toBe(true);
    expect(running).toBe(0);
  });

  it("re-probes an empty queue after held leases finish and expose another page", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const results: number[] = [];
    const promise = drainCrawlPool({
      concurrency: 2, deadline: Date.now() + 1_000,
      crawl: async () => {
        const index = calls++;
        await pause(index === 0 ? 100 : 10);
        return { attempted: [1, 0, 1, 0, 0, 0][index] ?? 0 };
      }, recoverable: () => true, onResult: r => results.push(r.attempted), onError: vi.fn(),
    });
    await vi.runAllTimersAsync();
    expect((await promise).drained).toBe(true);
    expect(results.filter(n => n === 1)).toHaveLength(2);
    expect(calls).toBeGreaterThanOrEqual(5);
  });

  it("starts nothing after the deadline but settles in-flight requests", async () => {
    vi.useFakeTimers();
    const crawl = vi.fn(async () => { await pause(100); return { attempted: 1 }; });
    const done = vi.fn();
    const promise = drainCrawlPool({
      concurrency: 2, deadline: Date.now() + 50, crawl,
      recoverable: () => true, onResult: done, onError: vi.fn(),
    });
    await vi.runAllTimersAsync();
    expect(await promise).toMatchObject({ requests: 2, drained: false, stopReason: "time-limit" });
    expect(done).toHaveBeenCalledTimes(2);
  });

  it("settles another active request before propagating an authorization failure", async () => {
    vi.useFakeTimers();
    let calls = 0; const done = vi.fn();
    const promise = drainCrawlPool({
      concurrency: 2, deadline: Date.now() + 1_000,
      crawl: async () => { const index = calls++; await pause(index === 0 ? 10 : 100);
        if (index === 0) throw new Error("HTTP 401"); return { attempted: 1 }; },
      recoverable: () => false, onResult: done, onError: vi.fn(),
    }).catch(error => error);
    await vi.runAllTimersAsync();
    expect((await promise).message).toBe("HTTP 401");
    expect(calls).toBe(2); expect(done).toHaveBeenCalledTimes(1);
  });

  it("backs off failures without launching an unbounded retry storm", async () => {
    vi.useFakeTimers();
    const onPressure = vi.fn(); const crawl = vi.fn(async () => { throw new Error("HTTP 503"); });
    const promise = drainCrawlPool({
      concurrency: 4, deadline: Date.now() + 200_000, crawl,
      recoverable: () => true, onResult: vi.fn(), onError: vi.fn(), onPressure,
    });
    await vi.runAllTimersAsync();
    expect((await promise).stopReason).toBe("consecutive-request-errors");
    expect(crawl).toHaveBeenCalledTimes(5);
    expect(onPressure.mock.calls.every(([concurrency]) => concurrency === 1)).toBe(true);
  });
});
