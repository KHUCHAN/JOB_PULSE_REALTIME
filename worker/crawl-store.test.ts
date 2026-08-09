import { describe, expect, it } from "vitest";
import { chunksByJsonBytes, chunksOf } from "./crawl-store";

describe("chunksOf", () => {
  it("keeps D1 write batches within the configured limit", () => {
    const values = Array.from({ length: 121 }, (_, index) => index);
    expect(chunksOf(values, 50).map((chunk) => chunk.length)).toEqual([50, 50, 21]);
    expect(chunksOf(values, 50).flat()).toEqual(values);
  });

  it("rejects invalid chunk sizes", () => {
    expect(() => chunksOf([1], 0)).toThrow("positive integer");
  });
});

describe("chunksByJsonBytes", () => {
  it("groups large catalogs into bounded JSON payloads without losing rows", () => {
    const values = Array.from({ length: 1_395 }, (_, index) => ({ id: index, title: `Role ${index}` }));
    const chunks = chunksByJsonBytes(values, 8_000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(values);
    expect(chunks.every((chunk) => new TextEncoder().encode(JSON.stringify(chunk)).byteLength <= 8_000)).toBe(true);
  });

  it("rejects a record larger than the payload budget", () => {
    expect(() => chunksByJsonBytes([{ value: "too large" }], 5)).toThrow("single job");
  });
});
