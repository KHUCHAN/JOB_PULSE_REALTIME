import { describe, expect, it } from "vitest";
import type { CrawledJob } from "../lib/crawler";
import { boundedJobRecord, compactRecord, D1CrawlStore, chunksByJsonBytes, chunksOf } from "./crawl-store";

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
  it("omits nullish optional fields without dropping required empty arrays", () => {
    expect(compactRecord({ title: "Role", location: null, skills: [], rawPayload: undefined })).toEqual({ title: "Role", skills: [] });
  });

  it("drops oversized raw payloads and strictly bounds every job record to 1.5 MB", () => {
    const bounded = boundedJobRecord({
      title: "Role", company: "Acme", officialUrl: "https://jobs.example/1", skills: [],
      description: "keep this description", rawPayload: { value: "x".repeat(1_600_000) },
    });

    expect(bounded.rawPayload).toBeUndefined();
    expect(bounded.description).toBe("keep this description");
    expect(new TextEncoder().encode(JSON.stringify([bounded])).byteLength).toBeLessThanOrEqual(1_500_000);
  });

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

  it("allows an explicitly bounded singleton for unusually long job descriptions", () => {
    const chunks = (chunksByJsonBytes as unknown as <T>(values: T[], maxBytes: number, maxSingleBytes: number) => T[][])([{ value: "x".repeat(120) }], 40, 200);
    expect(chunks).toEqual([[{ value: "x".repeat(120) }]]);
  });

  it("packs a realistic 10k-job payload into fewer than the free-tier D1 query budget", () => {
    const records = Array.from({ length: 10_000 }, (_, index) => ({
      id: `job-${index}`, title: `Role ${index}`, company: "Acme", summary: "x".repeat(1_000),
      officialUrl: `https://jobs.example/${index}`,
    }));

    expect(chunksByJsonBytes(records, 1_500_000, 1_900_000).length).toBeLessThan(45);
  });
});

describe("D1CrawlStore enriched job persistence", () => {
  const fakeDb = (options: { duplicateFacetConstraint?: boolean; failFacetInsert?: boolean } = {}) => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return {
              all: async () => ({ results: [] }),
              run: async () => {
                if (options.failFacetInsert && sql.includes("INSERT INTO source_facets")) {
                  throw new Error("injected facet insert failure");
                }
                if (options.duplicateFacetConstraint && sql.includes("INSERT INTO source_facets") && !sql.includes("ON CONFLICT")) {
                  throw new Error("UNIQUE constraint failed: source_facets.source_id, source_facets.facet_key, source_facets.value_key");
                }
                return {};
              },
            };
          },
        };
      },
    };
    return { db: db as unknown as D1Database, calls };
  };

  it("writes structured filter fields instead of dropping them from the job payload", async () => {
    const { db, calls } = fakeDb();
    const store = new D1CrawlStore(db);
    const job = {
      externalId: "REQ-42", title: "Data Engineer", company: "Acme", location: "San Francisco, CA",
      arrangement: "hybrid", employmentType: "Full-time", summary: "Build data.", description: "Build trusted data products.",
      department: "Data Platform", skills: ["SQL", "Python"], salaryMin: 120000, salaryMax: 160000,
      salaryCurrency: "USD", salaryInterval: "year", officialUrl: "https://jobs.example/42", publishedAt: "2026-08-01T00:00:00.000Z",
    } as CrawledJob;

    await store.syncJobs("source-1", [job], true);

    const insert = calls.find((call) => call.sql.includes("INSERT INTO jobs"));
    const record = JSON.parse(String(insert?.values[0]))[0];
    expect(record).toEqual(expect.objectContaining({
      description: "Build trusted data products.",
      department: "Data Platform",
      skills: ["SQL", "Python"],
      salaryMin: 120000,
      salaryMax: 160000,
      salaryCurrency: "USD",
      salaryInterval: "year",
    }));
    expect(insert?.sql).toContain("department = COALESCE(excluded.department, jobs.department)");
    expect(insert?.sql).toContain("salary_min = COALESCE(excluded.salary_min, jobs.salary_min)");
    expect(insert?.sql).toContain("responsibilities = COALESCE(excluded.responsibilities, jobs.responsibilities)");
    expect(insert?.sql).toContain("external_id = COALESCE(excluded.external_id, jobs.external_id)");
    expect(insert?.sql).toContain("location = COALESCE(excluded.location, jobs.location)");
    expect(insert?.sql).toContain("arrangement = CASE WHEN excluded.arrangement = 'unknown' THEN jobs.arrangement ELSE excluded.arrangement END");
    expect(insert?.sql).toContain("employment_type = COALESCE(excluded.employment_type, jobs.employment_type)");
    expect(insert?.sql).toContain("description_hash = COALESCE(excluded.description_hash, jobs.description_hash)");
  });

  it("upserts AI/data membership and clears stale membership for every processed job", async () => {
    const { db, calls } = fakeDb();
    const store = new D1CrawlStore(db);
    const jobs = [{
      externalId: "data-1", title: "Data Engineer", company: "Acme", location: "Remote",
      arrangement: "remote" as const, employmentType: "Full-time", summary: "Build pipelines.",
      officialUrl: "https://jobs.example/data-1", publishedAt: null,
    }, {
      externalId: "sales-1", title: "Account Executive", company: "Acme", location: "Remote",
      arrangement: "remote" as const, employmentType: "Full-time", summary: "Manage customer accounts.",
      officialUrl: "https://jobs.example/sales-1", publishedAt: null,
    }] as CrawledJob[];

    await store.syncJobs("source-1", jobs, false);

    const jobsInsert = calls.find((call) => call.sql.includes("INSERT INTO jobs"));
    const jobRecords = JSON.parse(String(jobsInsert?.values[0]));
    expect(jobRecords.every((record: Record<string, unknown>) => typeof record.topicClassifiedAt === "string")).toBe(true);

    const topicInsert = calls.find((call) => call.sql.includes("INSERT INTO job_topics"));
    const topicRecords = JSON.parse(String(topicInsert?.values[0]));
    expect(topicRecords).toEqual([
      expect.objectContaining({ officialUrl: "https://jobs.example/data-1", score: expect.any(Number) }),
    ]);
    expect(topicRecords[0].evidence).toContain("title:data engineering");

    const staleDelete = calls.find((call) => call.sql.includes("DELETE FROM job_topics"));
    expect(staleDelete?.sql).toContain("topic_key = 'ai-data'");
    expect(JSON.parse(String(staleDelete?.values[0]))).toEqual([
      expect.objectContaining({ officialUrl: "https://jobs.example/sales-1" }),
    ]);
  });

  it("upserts source-native facet values observed during the crawl", async () => {
    const { db, calls } = fakeDb();
    const store = new D1CrawlStore(db);

    await (store.syncJobs as unknown as (...args: unknown[]) => Promise<unknown>)("source-1", [], true, [{
      key: "jobFamilyGroup",
      label: "Job Category",
      values: [{ key: "eng", label: "Engineering", count: 12 }],
    }]);

    expect(calls.some((call) => call.sql.includes("INSERT INTO source_facets"))).toBe(true);
    const leaseIndex = calls.findIndex((call) => call.sql.includes("facet_sync_generation"));
    const insertIndex = calls.findIndex((call) => call.sql.includes("INSERT INTO source_facets"));
    const cleanupIndex = calls.findIndex((call) => call.sql.includes("DELETE FROM source_facets"));
    expect(leaseIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBeGreaterThan(leaseIndex);
    expect(cleanupIndex).toBeGreaterThan(insertIndex);
    expect(calls[insertIndex].sql).toContain("facet_sync_generation");
    expect(calls[insertIndex].values.at(-1)).toBe(calls[leaseIndex].values[0]);
    expect(calls[cleanupIndex].sql).toContain("facet_sync_generation");
    expect(calls[cleanupIndex].values.at(-1)).toBe(calls[leaseIndex].values[0]);
  });

  it("clears stale facets when a verified complete listing becomes empty", async () => {
    const { db, calls } = fakeDb();
    const store = new D1CrawlStore(db);

    await store.syncJobs("source-1", [], true);

    expect(calls.some((call) => call.sql.includes("DELETE FROM source_facets"))).toBe(true);
  });

  it("does not replace authoritative facets with values derived from an incomplete listing", async () => {
    const { db, calls } = fakeDb();
    const store = new D1CrawlStore(db);
    const job = {
      externalId: "1", title: "Role", company: "Acme", location: "Remote", arrangement: "remote" as const,
      employmentType: "Full-time", summary: null, department: "Partial Department",
      officialUrl: "https://jobs.example/1", publishedAt: null,
    } as CrawledJob;

    await store.syncJobs("source-1", [job], false);

    expect(calls.some((call) => call.sql.includes("INSERT INTO source_facets"))).toBe(false);
    expect(calls.some((call) => call.sql.includes("DELETE FROM source_facets"))).toBe(false);
  });

  it("keeps the previous facet snapshot when replacement inserts fail", async () => {
    const { db, calls } = fakeDb({ failFacetInsert: true });
    const store = new D1CrawlStore(db);

    await expect((store.syncJobs as unknown as (...args: unknown[]) => Promise<unknown>)("source-1", [], false, [{
      key: "department", label: "Department", values: [{ key: "Engineering", label: "Engineering", count: 10 }],
    }])).rejects.toThrow("injected facet insert failure");

    expect(calls.some((call) => call.sql.includes("DELETE FROM source_facets"))).toBe(false);
  });

  it("derives company facet values from structured jobs when the ATS has no native facet payload", async () => {
    const { db, calls } = fakeDb();
    const store = new D1CrawlStore(db);
    const jobs = ["Data Platform", "Risk"].map((department, index) => ({
      externalId: String(index), title: `Role ${index}`, company: "Acme", location: "Remote, US",
      arrangement: "remote" as const, employmentType: "Full-time", summary: null, department,
      skills: ["SQL"], officialUrl: `https://jobs.example/${index}`, publishedAt: null,
    })) as CrawledJob[];

    await store.syncJobs("source-1", jobs, true);

    const facetInsert = calls.find((call) => call.sql.includes("INSERT INTO source_facets"));
    const records = JSON.parse(String(facetInsert?.values[0]));
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ facetKey: "department", valueKey: "Data Platform", jobCount: 1 }),
      expect.objectContaining({ facetKey: "department", valueKey: "Risk", jobCount: 1 }),
      expect.objectContaining({ facetKey: "skills", valueKey: "SQL", jobCount: 2 }),
      expect.objectContaining({ facetKey: "arrangement", valueKey: "remote", jobCount: 2 }),
    ]));
  });

  it("keeps facet persistence idempotent when the database observes a concurrent duplicate", async () => {
    const { db } = fakeDb({ duplicateFacetConstraint: true });
    const store = new D1CrawlStore(db);

    await expect((store.syncJobs as unknown as (...args: unknown[]) => Promise<unknown>)("source-1", [], true, [{
      key: "department", label: "Department", values: [{ key: "Engineering", label: "Engineering", count: 10 }],
    }])).resolves.toBeDefined();
  });

  it("persists a 10k-job catalog within the free-tier D1 query budget", async () => {
    const { db, calls } = fakeDb();
    const store = new D1CrawlStore(db);
    const jobs = Array.from({ length: 10_000 }, (_, index) => ({
      externalId: String(index), title: `Role ${index}`, company: "Acme", location: null,
      arrangement: "unknown" as const, employmentType: null, summary: null,
      officialUrl: `https://jobs.example/${index}`, publishedAt: null,
    })) as CrawledJob[];

    await store.syncJobs("source-1", jobs, false);

    expect(calls.some((call) => call.sql.includes("INSERT INTO jobs"))).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(50);
  }, 30_000);

  it("compacts a job with more than 1.9 MB of optional content instead of aborting the source", async () => {
    const { db, calls } = fakeDb();
    const store = new D1CrawlStore(db);
    const job = {
      externalId: "1", title: "Role", company: "Acme", location: null, arrangement: "unknown" as const,
      employmentType: null, summary: "summary", description: "x".repeat(2_000_000),
      officialUrl: "https://jobs.example/1", publishedAt: null,
    } as CrawledJob;

    await expect(store.syncJobs("source-1", [job], false)).resolves.toBeDefined();
    const payload = String(calls.find((call) => call.sql.includes("INSERT INTO jobs"))?.values[0]);
    expect(new TextEncoder().encode(payload).byteLength).toBeLessThanOrEqual(1_500_000);
  });
});

describe("D1CrawlStore source leasing", () => {
  it("claims due sources before returning them so parallel batches cannot overlap", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return { all: async () => ({ results: [{
              id: "source-1", company: "Acme", posting_url: "https://example.com/jobs",
              adapter: "custom", next_crawl_at: String(values[0]),
            }] }) };
          },
        };
      },
    } as unknown as D1Database;

    const sources = await new D1CrawlStore(db).dueSources("2026-08-09T12:00:00.000Z", 16);

    expect(sources).toHaveLength(1);
    expect(calls[0].sql).toContain("UPDATE sources");
    expect(calls[0].sql).toContain("RETURNING id, company, posting_url, adapter, next_crawl_at");
    expect(calls[0].values).toEqual(["2026-08-09T12:10:00.000Z", "2026-08-09T12:00:00.000Z", 16]);
  });
});
