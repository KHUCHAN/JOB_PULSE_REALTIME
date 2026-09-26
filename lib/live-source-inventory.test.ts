import { describe, expect, it, vi } from "vitest";
import { fetchLiveSourceInventory, inventoryFailureHandoff } from "./live-source-inventory";

const url = "https://example.com/api/pulse?resource=sources&ids=a,b";
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const wait = async () => {};

describe("live source inventory", () => {
  it("retries a transient D1 queue timeout instead of dropping the whole critical lane", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new DOMException("The operation was aborted due to timeout", "TimeoutError"))
      .mockResolvedValueOnce(new Response("{\"error\":\"D1_ERROR: D1 DB is overloaded.\"}", { status: 500 }))
      .mockResolvedValueOnce(ok([{ id: "a" }, { id: "b" }]));
    await expect(fetchLiveSourceInventory(url, { fetcher, wait })).resolves.toEqual([{ id: "a" }, { id: "b" }]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not retry a permanent client error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad", { status: 400 }));
    await expect(fetchLiveSourceInventory(url, { fetcher, wait })).rejects.toThrow("HTTP 400");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("gives up after the bounded attempts with the last cause", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    await expect(fetchLiveSourceInventory(url, { fetcher, wait, attempts: 3 }))
      .rejects.toThrow("Live source inventory unavailable after 3 attempts: The operation was aborted due to timeout");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects a non-array inventory body", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(ok({ error: "nope" }));
    await expect(fetchLiveSourceInventory(url, { fetcher, wait })).rejects.toThrow("not a source list");
  });

  it("records every requested source as failed when the inventory never loads", () => {
    const handoff = inventoryFailureHandoff(["a", "b", "a"], new Error("Live source inventory unavailable after 4 attempts: timeout"));
    expect(handoff).toEqual({
      attempted: 2,
      summaries: [
        { sourceId: "a", status: "failed", jobs: 0, created: 0, updated: 0, elapsedMs: 0, error: "Live source inventory unavailable after 4 attempts: timeout" },
        { sourceId: "b", status: "failed", jobs: 0, created: 0, updated: 0, elapsedMs: 0, error: "Live source inventory unavailable after 4 attempts: timeout" },
      ],
    });
  });
});
