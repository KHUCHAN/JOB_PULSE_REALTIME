import { describe, expect, it, vi, afterEach } from "vitest";
import { abortableRecovery, recoveryFetch } from "./abortable-recovery";
afterEach(() => vi.useRealTimers());
describe("bounded recovery stages", () => {
  it("aborts outstanding I/O and forbids late pages before the next stage", async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const fetcher = vi.fn(async () => new Response("ok"));
    const pending = abortableRecovery(async stage => {
      signal = stage;
      return new Promise(() => {});
    }, 100);
    const rejected = expect(pending).rejects.toThrow("deadline exceeded");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(signal.aborted).toBe(true);
    expect(() => recoveryFetch(fetcher, signal)("https://example.com")).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("honors parent cancellation and releases successful stage timers", async () => {
    const parent = new AbortController();
    const pending = abortableRecovery(async () => new Promise(() => {}), 1000, parent.signal);
    parent.abort(new Error("owner stopped"));
    await expect(pending).rejects.toThrow("owner stopped");
    await expect(abortableRecovery(async () => 12, 1000)).resolves.toBe(12);
  });
});
