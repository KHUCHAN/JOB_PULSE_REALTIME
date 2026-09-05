import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceFetchBudget } from "./source-fetch-budget";

afterEach(() => vi.useRealTimers());
describe("source fetch deadline", () => {
  it("shares a deadline across pages and aborts in-flight requests", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn(async (_input, init) => {
      signals.push(init!.signal!);
      return new Response("page");
    }) as unknown as typeof fetch;
    const budget = sourceFetchBudget(100, fetcher);
    await budget.fetch("https://example.com/1");
    await vi.advanceTimersByTimeAsync(90);
    await budget.fetch("https://example.com/2");
    await vi.advanceTimersByTimeAsync(10);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(() => budget.fetch("https://example.com/3")).toThrow("Source fetch budget");
    expect(fetcher).toHaveBeenCalledTimes(2);
    budget.dispose();
  });
  it("preserves the adapter's shorter timeout and Request abort signal", async () => {
    const requestAbort = new AbortController();
    const adapterAbort = new AbortController();
    const observed: AbortSignal[] = [];
    const budget = sourceFetchBudget(1000, (async (_input, init) => {
      observed.push(init!.signal!); return new Response("ok");
    }) as typeof fetch);
    await budget.fetch(new Request("https://example.com", { signal: requestAbort.signal }));
    await budget.fetch("https://example.com", { signal: adapterAbort.signal });
    requestAbort.abort(); adapterAbort.abort();
    expect(observed.every(signal => signal.aborted)).toBe(true);
    budget.check();
    budget.dispose();
  });
  it("does not abort completed collection during downstream ingestion", async () => {
    vi.useFakeTimers();
    const budget = sourceFetchBudget(100);
    budget.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(() => budget.check()).not.toThrow();
  });
});
