import { expect, it, vi } from "vitest";
import { createSnapshotWriter } from "./snapshot-writer";

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
  const upstream = vi.fn().mockRejectedValueOnce(new Error("socket closed"))
    .mockResolvedValueOnce(new Response("busy", { status: 503, headers: { "retry-after": "1" } }));
  const writer = createSnapshotWriter(1, upstream);
  const timing = { waitMs: 0, writeMs: 0, requests: 0 };
  await expect(writer(timing)("https://example.com")).rejects.toThrow("socket closed");
  const response = await writer(timing)("https://example.com");
  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("1");
  expect(await response.text()).toBe("busy");
  expect(timing.requests).toBe(2);
});

it("does not send a queued request after cancellation", async () => {
  const upstream = vi.fn(async () => new Response(null, { status: 204 }));
  const writer = createSnapshotWriter(1, upstream);
  const controller = new AbortController();
  controller.abort();
  await expect(writer()("https://example.com", { signal: controller.signal })).rejects.toThrow();
  expect(upstream).not.toHaveBeenCalled();
  expect((await writer()("https://example.com")).status).toBe(204);
});
