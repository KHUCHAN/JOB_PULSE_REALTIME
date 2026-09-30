import { afterEach, expect, it, vi } from "vitest";
import { createSnapshotWriter } from "./snapshot-writer";
afterEach(() => vi.useRealTimers());

it("starts the network deadline after queue admission and cools other sources after overload", async () => {
  vi.useFakeTimers();
  const start = Date.now(); const starts: number[] = [];
  const upstream = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    starts.push(Date.now() - start);
    expect(init?.signal?.aborted).toBe(false);
    return starts.length === 1 ? new Response("busy", { status: 503 }) : new Response("ok");
  });
  const writer = createSnapshotWriter(1, upstream);
  const a = writer()("https://example.com/a", { requestTimeoutMs: 100 });
  const b = writer()("https://example.com/b", { requestTimeoutMs: 100 });
  await vi.runAllTimersAsync();
  expect((await a).status).toBe(503); expect((await b).status).toBe(200);
  expect(starts).toEqual([0, 5_000]);
});

it("holds the writer until the response body completes, not just headers", async () => {
  let finish!: () => void;
  const upstream = vi.fn(async () => upstream.mock.calls.length === 1
    ? new Response(new ReadableStream({ start(controller) { finish = () => { controller.enqueue(new TextEncoder().encode("first")); controller.close(); }; } }))
    : new Response("second"));
  const writer = createSnapshotWriter(1, upstream);
  const first = writer()("https://example.com/1");
  const second = writer()("https://example.com/2");
  await Promise.resolve();
  expect(upstream).toHaveBeenCalledTimes(1);
  finish();
  expect(await (await first).text()).toBe("first");
  expect(await (await second).text()).toBe("second");
});

it("releases capacity after failure and retains status/body for transport retries", async () => {
  vi.useFakeTimers();
  const upstream = vi.fn().mockRejectedValueOnce(new Error("socket closed"))
    .mockResolvedValueOnce(new Response("busy", { status: 503, headers: { "retry-after": "1" } }));
  const writer = createSnapshotWriter(1, upstream);
  const timing = { waitMs: 0, writeMs: 0, requests: 0 };
  await expect(writer(timing)("https://example.com")).rejects.toThrow("socket closed");
  const pending = writer(timing)("https://example.com");
  await vi.runAllTimersAsync();
  const response = await pending;
  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("1");
  expect(await response.text()).toBe("busy");
  expect(timing.requests).toBe(2);
});

it("does not send a queued request after cancellation", async () => {
  vi.useFakeTimers();
  const upstream = vi.fn(async () => new Response(null, { status: 204 }));
  const writer = createSnapshotWriter(1, upstream);
  const controller = new AbortController();
  controller.abort();
  await expect(writer()("https://example.com", { signal: controller.signal })).rejects.toThrow();
  expect(upstream).not.toHaveBeenCalled();
  const pending = writer()("https://example.com");
  await vi.runAllTimersAsync();
  expect((await pending).status).toBe(204);
});
