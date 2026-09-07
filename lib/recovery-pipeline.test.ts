import { afterEach, expect, it, vi } from "vitest";
import { runRecoveryPipeline } from "./recovery-pipeline";
import { createFifoLimiter } from "./fifo-limiter";

afterEach(() => vi.useRealTimers());
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

it("overlaps upstream collection with saving without raising either limit or losing order", async () => {
  vi.useFakeTimers();
  let fetching = 0, writing = 0, resident = 0;
  let maxFetch = 0, maxWrite = 0, maxResident = 0;
  const writer = createFifoLimiter(1);
  const starts: number[] = [];
  const start = Date.now();
  const run = runRecoveryPipeline([0, 1, 2, 3, 4, 5], {
    concurrency: 2, pendingLimit: 4,
    collect: async n => {
      starts[n] = Date.now() - start;
      maxFetch = Math.max(maxFetch, ++fetching);
      maxResident = Math.max(maxResident, ++resident);
      await pause(10); fetching--;
      return { identity: n, officialDate: "2026-09-06", complete: true };
    },
    persist: async (n, catalog) => writer(async () => {
      maxWrite = Math.max(maxWrite, ++writing);
      expect(catalog.identity).toBe(n);
      await pause(100); writing--; resident--;
      return catalog;
    }),
    failed: (_n, error) => { throw error; },
  });
  await vi.runAllTimersAsync();
  expect((await run).map(r => r.identity)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(starts.slice(0, 4)).toEqual([0, 0, 10, 10]);
  expect(maxFetch).toBe(2); expect(maxWrite).toBe(1); expect(maxResident).toBe(4);
  expect(resident).toBe(0);
});

it("reports collection and persistence failures once, releases slots and waits for all saves", async () => {
  vi.useFakeTimers();
  const persisted: number[] = [], completed: string[] = [];
  const run = runRecoveryPipeline([0, 1, 2, 3], {
    concurrency: 1, pendingLimit: 2,
    collect: async n => { await pause(5); if (n === 0) throw Error("fetch"); return n; },
    persist: async n => { persisted.push(n); await pause(100); if (n === 1) throw Error("save"); return `ok:${n}`; },
    failed: (n, e) => `failed:${n}:${(e as Error).message}`,
    onResult: r => completed.push(r),
  });
  await vi.runAllTimersAsync();
  expect(await run).toEqual(["failed:0:fetch", "failed:1:save", "ok:2", "ok:3"]);
  expect(persisted).toEqual([1, 2, 3]); expect(completed).toHaveLength(4);
});

it("handles no sources and rejects invalid bounds before starting work", async () => {
  const collect = vi.fn(async (n: number) => n);
  const options = { concurrency: 2, pendingLimit: 4, collect, persist: async (n: number) => n, failed: () => -1 };
  expect(await runRecoveryPipeline([], options)).toEqual([]);
  await expect(runRecoveryPipeline([1], { ...options, pendingLimit: 1 })).rejects.toThrow("pending limit");
  expect(collect).not.toHaveBeenCalled();
});

it("reduces a controlled fetch/save overlap fixture without changing work or writer count", async () => {
  vi.useFakeTimers();
  const replay = async (pendingLimit: number) => {
    const start = Date.now();
    const writer = createFifoLimiter(1);
    const run = runRecoveryPipeline([0, 1, 2, 3], {
      concurrency: 2, pendingLimit,
      collect: async n => { await pause(100); return n; },
      persist: (n: number) => writer(async () => { await pause(10); return n; }),
      failed: () => -1,
    });
    await vi.runAllTimersAsync();
    expect(await run).toEqual([0, 1, 2, 3]);
    return Date.now() - start;
  };
  expect(await replay(2)).toBe(230);
  expect(await replay(4)).toBe(220);
});
