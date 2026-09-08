import { describe, expect, it } from "vitest";
import { crawlPressure } from "./crawl-pressure";

describe("crawl backpressure", () => {
  it("requires both three clean rounds and elapsed healthy time before growing", () => {
    let now = 0;
    const p = crawlPressure(4, () => now);
    expect(p.concurrency).toBe(2);
    for (let i = 0; i < 2; i++) expect(p.observe(0)).toBe(0);
    expect(p.concurrency).toBe(2);
    p.observe(0); expect(p.concurrency).toBe(2);
    now = 30_000;
    p.observe(0); expect(p.concurrency).toBe(3);
    for (let i = 0; i < 20; i++) p.observe(0);
    expect(p.concurrency).toBe(3);
    now = 60_000;
    p.observe(0);
    expect(p.concurrency).toBe(4);
  });
  it("backs off partial failures as well as complete outages, with bounded cooldown", () => {
    const p = crawlPressure(4, () => 0);
    expect(p.observe(1)).toBe(5000); expect(p.concurrency).toBe(1);
    expect(p.observe(1)).toBe(10000);
    expect(p.observe(1)).toBe(20000);
    expect(p.observe(1)).toBe(30000);
    p.observe(0); expect(p.observe(1)).toBe(30000);
  });
  it("does not undo overload backoff with fast completions from held requests", () => {
    let now = 0;
    const p = crawlPressure(4, () => now);
    p.observe(1);
    for (let i = 0; i < 100; i++) p.observe(0);
    expect(p.concurrency).toBe(1);
    now = 59_999; p.observe(0); expect(p.concurrency).toBe(1);
    now = 60_000; p.observe(0); expect(p.concurrency).toBe(2);
    for (let i = 0; i < 100; i++) p.observe(0);
    expect(p.concurrency).toBe(2);
    now = 90_000; p.observe(0); expect(p.concurrency).toBe(3);
    // A genuinely stable recovery resets the bounded exponential cooldown.
    expect(p.observe(1)).toBe(5000);
  });
  it("restarts the recovery interval on intermittent failures", () => {
    let now = 0;
    const p = crawlPressure(4, () => now);
    p.observe(1);
    now = 50_000;
    for (let i = 0; i < 10; i++) p.observe(0);
    expect(p.observe(1)).toBe(10000);
    now = 60_000;
    for (let i = 0; i < 10; i++) p.observe(0);
    expect(p.concurrency).toBe(1);
    now = 110_000; p.observe(0); expect(p.concurrency).toBe(2);
  });
  it("never exceeds a single-request configuration", () => {
    const p = crawlPressure(1);
    for (let i = 0; i < 20; i++) p.observe(0);
    expect(p.concurrency).toBe(1);
  });
});
