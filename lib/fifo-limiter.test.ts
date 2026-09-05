import { expect, it } from "vitest";
import { createFifoLimiter } from "./fifo-limiter";

it("interleaves short catalogs between a large catalog's chunks", async () => {
  const lease = createFifoLimiter(1);
  const order: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const large = (async () => {
    await lease(async () => { order.push("large-1"); await blocked; });
    await lease(async () => { order.push("large-2"); });
  })();
  const short = lease(async () => { order.push("short"); });
  release();
  await Promise.all([large, short]);
  expect(order).toEqual(["large-1", "short", "large-2"]);
});

it("preserves the writer cap and releases leases after failures", async () => {
  const lease = createFifoLimiter(2);
  let active = 0, peak = 0;
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => lease(async () => {
    peak = Math.max(peak, ++active);
    try {
      await Promise.resolve();
      if (index % 3 === 0) throw new Error("failed chunk");
      return index;
    } finally { active -= 1; }
  })));
  expect(peak).toBe(2);
  expect(active).toBe(0);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(7);
  expect(await lease(async () => "recovered")).toBe("recovered");
});
