import { describe, expect, it, vi } from "vitest";
import type { CrawledJob } from "./crawler";
import { browserIngestChunks, browserIngestRecord, ingestJobSnapshotInChunks } from "./job-snapshot-transport";

const job = (index: number, extra: Partial<CrawledJob> = {}): CrawledJob => ({
  externalId: `job-${index}`,
  title: `Software Engineering Intern ${index}`,
  company: "Acme",
  location: "Austin, TX",
  arrangement: "onsite",
  employmentType: "Internship",
  summary: "Build reliable systems.",
  officialUrl: `https://jobs.example.com/job-${index}`,
  publishedAt: "2026-08-23T00:00:00.000Z",
  ...extra,
});

describe("browser job snapshot transport", () => {
  it("drops unused raw payloads and bounds accepted rich text", () => {
    const record = browserIngestRecord(job(1, {
      description: "d".repeat(120_000),
      rawPayload: { document: "x".repeat(2_000_000) },
    }));
    expect(record.rawPayload).toBeUndefined();
    expect(String(record.description)).toHaveLength(100_000);
  });

  it("bounds chunks by both record count and encoded bytes", () => {
    const chunks = browserIngestChunks(
      Array.from({ length: 7 }, (_, index) => job(index, { description: "x".repeat(12_000) })),
      { maxBytes: 32_000, maxJobs: 3 },
    );
    expect(chunks.flat()).toHaveLength(7);
    expect(chunks.every((chunk) => chunk.length <= 3)).toBe(true);
    expect(chunks.every((chunk) => Buffer.byteLength(JSON.stringify(chunk)) <= 32_000)).toBe(true);
  });

  it("marks only the final chunk authoritative and aggregates persistence totals", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ jobs: 2, created: 1, updated: 1, closed: bodies.length === 2 ? 3 : 0 });
    });
    const result = await ingestJobSnapshotInChunks({
      allowedOrigins: ["https://jobs.example.com"],
      authorization: async () => "token",
      completeListing: true,
      endpoint: "https://pulse.example/api/pulse",
      fetcher: fetcher as typeof fetch,
      jobs: Array.from({ length: 4 }, (_, index) => job(index)),
      listingUrl: "https://jobs.example.com",
      maxJobs: 2,
      sourceId: "source-1",
    });

    expect(result).toEqual({ jobs: 4, created: 2, updated: 2, closed: 3, chunks: 2 });
    expect(bodies.map((body) => body.completeListing)).toEqual([false, false]);
    expect(bodies.map((body) => body.finalizeSnapshot)).toEqual([false, true]);
    expect(bodies.map((body) => body.replaceFacets)).toEqual([false, false]);
    expect(bodies[0].snapshotStartedAt).toBe(bodies[1].snapshotStartedAt);
  });

  it("retries transient persistence failures with fresh authorization and one snapshot identity", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const authorization = vi.fn(async () => `token-${authorization.mock.calls.length}`);
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (bodies.length === 1) return Response.json({ error: "temporary" }, { status: 503 });
      return Response.json({ jobs: 1, created: 1, updated: 0, closed: 0 });
    });

    const result = await ingestJobSnapshotInChunks({
      allowedOrigins: ["https://jobs.example.com"],
      authorization,
      completeListing: true,
      endpoint: "https://pulse.example/api/pulse",
      fetcher: fetcher as typeof fetch,
      jobs: [job(1)],
      listingUrl: "https://jobs.example.com",
      retryDelayMs: 0,
      sourceId: "source-1",
    });

    expect(result).toEqual({ jobs: 1, created: 1, updated: 0, closed: 0, chunks: 1 });
    expect(authorization).toHaveBeenCalledTimes(2);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].snapshotStartedAt).toBe(bodies[1].snapshotStartedAt);
    expect(bodies[0].finalizeSnapshot).toBe(true);
    expect(bodies[1].finalizeSnapshot).toBe(true);
  });
});
