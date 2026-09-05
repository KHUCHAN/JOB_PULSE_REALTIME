import { describe, expect, it } from "vitest";
import { crawlPressure } from "./crawl-pressure";

describe("crawl backpressure", () => {
  it("starts below capacity and only grows after three clean rounds", () => {
    const p = crawlPressure(4);
    expect(p.concurrency).toBe(2);
    for (let i = 0; i < 2; i++) expect(p.observe(0)).toBe(0);
    expect(p.concurrency).toBe(2);
    p.observe(0); expect(p.concurrency).toBe(3);
    for (let i = 0; i < 20; i++) p.observe(0);
    expect(p.concurrency).toBe(4);
  });
  it("backs off partial failures as well as complete outages, with bounded cooldown", () => {
    const p = crawlPressure(4);
    expect(p.observe(1)).toBe(5000); expect(p.concurrency).toBe(1);
    expect(p.observe(1)).toBe(10000);
    expect(p.observe(1)).toBe(20000);
    expect(p.observe(1)).toBe(30000);
    p.observe(0); expect(p.observe(1)).toBe(5000);
  });
  it("never exceeds a single-request configuration", () => {
    const p = crawlPressure(1);
    for (let i = 0; i < 20; i++) p.observe(0);
    expect(p.concurrency).toBe(1);
  });
});
