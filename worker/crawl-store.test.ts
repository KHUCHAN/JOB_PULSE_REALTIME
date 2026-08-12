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
  const fakeDb = (options: {
    duplicateFacetConstraint?: boolean;
    failFacetInsert?: boolean;
    existingJobs?: Array<{ id: string; external_id: string | null; title: string; official_url: string; status: string; resume_match_hash: string | null }>;
  } = {}) => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return {
              all: async () => ({
                results: sql.includes("SELECT id, external_id, title, official_url, status, resume_match_hash")
                  ? options.existingJobs ?? []
                  : [],
              }),
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
    expect(insert?.sql).toContain("WHEN jobs.status = 'closed' THEN jobs.open_generation + 1");
  });

  it("repairs a changed canonical URL in place when the ATS external ID is stable", async () => {
    const { db, calls } = fakeDb({
      existingJobs: [{
        id: "job-42",
        external_id: "REQ-42",
        title: "Role",
        official_url: "https://acme.wd5.myworkdayjobs.com/job/Role_REQ-42",
        status: "open",
        resume_match_hash: null,
      }],
    });
    const store = new D1CrawlStore(db);

    await store.syncJobs("source-1", [{
      externalId: "REQ-42",
      title: "Role",
      company: "Acme",
      location: null,
      arrangement: "unknown",
      employmentType: null,
      summary: null,
      officialUrl: "https://acme.wd5.myworkdayjobs.com/Careers/job/Role_REQ-42",
      publishedAt: null,
    }], false);

    const repair = calls.find((call) => call.sql.includes("UPDATE jobs") && call.sql.includes("officialUrl") && call.sql.includes("json_each"));
    expect(repair).toBeDefined();
    expect(JSON.parse(String(repair?.values[0]))).toEqual([{
      id: "job-42",
      officialUrl: "https://acme.wd5.myworkdayjobs.com/Careers/job/Role_REQ-42",
    }]);
  });

  it("changes the resume evaluation hash when company or posting date changes", async () => {
    const { db, calls } = fakeDb();
    const store = new D1CrawlStore(db);
    const common = {
      externalId: "REQ-42", title: "Machine Learning Intern", location: "San Francisco, CA",
      arrangement: "hybrid" as const, employmentType: "Internship", summary: "Build models.",
    };
    const jobs = [
      { ...common, company: "Acme", officialUrl: "https://jobs.example/hash-a", publishedAt: null },
      { ...common, company: "Acme Labs", officialUrl: "https://jobs.example/hash-b", publishedAt: null },
      { ...common, company: "Acme", officialUrl: "https://jobs.example/hash-c", publishedAt: "2026-08-10T00:00:00.000Z" },
    ] as CrawledJob[];

    await store.syncJobs("source-1", jobs, false);

    const insert = calls.find((call) => call.sql.includes("INSERT INTO jobs"));
    const records = JSON.parse(String(insert?.values[0])) as Array<{ resumeMatchHash: string }>;
    expect(new Set(records.map((record) => record.resumeMatchHash))).toHaveLength(3);
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

  it("stores direct job areas and location regions while clearing stale managed areas", async () => {
    const { db, calls } = fakeDb();
    const store = new D1CrawlStore(db);
    const jobs = [{
      externalId: "swe-1", title: "Spring 2027 Software Engineering Internship/Co-op",
      company: "Acme", location: "Hawthorne, CA", locationCountry: "United States",
      arrangement: "onsite" as const, employmentType: "Internship", summary: "Build flight software.",
      officialUrl: "https://jobs.example/swe-1", publishedAt: "2026-08-08T00:00:00.000Z",
    }, {
      externalId: "leadership-1", title: "2027 Leadership Development Program Intern",
      company: "Acme", location: "Remote", arrangement: "remote" as const,
      employmentType: "Internship", summary: "Rotate through business teams.",
      officialUrl: "https://jobs.example/leadership-1", publishedAt: null,
    }] as CrawledJob[];

    await store.syncJobs("source-1", jobs, false);

    const jobsInsert = calls.find((call) => call.sql.includes("INSERT INTO jobs"));
    const records = JSON.parse(String(jobsInsert?.values[0]));
    expect(records[0]).toEqual(expect.objectContaining({
      locationRegion: "us",
      areaClassifiedAt: expect.stringMatching(/^v3:/),
      areaMemberships: [expect.objectContaining({ topicKey: "area:software-engineering" })],
    }));
    expect(records[1]).toEqual(expect.objectContaining({
      locationRegion: "unknown",
      areaClassifiedAt: expect.any(String),
      areaMemberships: [],
    }));
    expect(jobsInsert?.sql).toContain("location_region = CASE WHEN excluded.location_region = 'unknown'");
    const areaDelete = calls.find((call) => call.sql.includes("topic_key LIKE 'area:%'"));
    expect(JSON.parse(String(areaDelete?.values[0]))).toHaveLength(2);
    const areaInsert = calls.find((call) => call.sql.includes("'area:' ||"));
    expect(JSON.parse(String(areaInsert?.values[0]))).toEqual([
      expect.objectContaining({
        officialUrl: "https://jobs.example/swe-1",
        areaKey: "software-engineering",
      }),
    ]);
  });

  it("indexes every recognized internship title during crawl persistence", async () => {
    const { db, calls } = fakeDb();
    const store = new D1CrawlStore(db);
    const jobs = [{
      externalId: "intern-1", title: "2027 Machine Learning Intern / Co-op", company: "Acme", location: "Remote",
      arrangement: "remote" as const, employmentType: null, summary: "Build models.",
      officialUrl: "https://jobs.example/intern-1", publishedAt: null,
    }, {
      externalId: "audit-1", title: "2027 Internal Audit Analyst", company: "Acme", location: null,
      arrangement: "unknown" as const, employmentType: "R244285", summary: null,
      officialUrl: "https://jobs.example/audit-1", publishedAt: null,
    }] as CrawledJob[];

    await store.syncJobs("source-1", jobs, false);

    const jobsInsert = calls.find((call) => call.sql.includes("INSERT INTO jobs"));
    const jobRecords = JSON.parse(String(jobsInsert?.values[0]));
    expect(jobRecords[0]).toEqual(expect.objectContaining({
      employmentType: "Internship",
      programKeys: ["internship", "coop"],
    }));
    expect(jobRecords[1].employmentType).toBeUndefined();
    expect(calls.some((call) => call.sql.includes("topic_key LIKE 'program:%'"))).toBe(true);
    const insert = calls.find((call) => call.sql.includes("'program:' ||"));
    expect(JSON.parse(String(insert?.values[0]))).toEqual([
      expect.objectContaining({ programKey: "internship", evidence: "title:intern" }),
      expect.objectContaining({ programKey: "coop", evidence: "title:co-op" }),
    ]);
  });

  it("indexes authoritative ATS internship types even when the title only says student", async () => {
    const { db, calls } = fakeDb();
    const store = new D1CrawlStore(db);
    const job = {
      externalId: "student-1", title: "AI Product Analyst student", company: "Intel", location: "Israel, Haifa",
      arrangement: "onsite" as const, employmentType: "Internship; Full-time", summary: null,
      officialUrl: "https://jobs.example/student-1", publishedAt: null,
    } as CrawledJob;

    await store.syncJobs("source-1", [job], false);

    const jobsInsert = calls.find((call) => call.sql.includes("INSERT INTO jobs"));
    expect(JSON.parse(String(jobsInsert?.values[0]))[0]).toEqual(expect.objectContaining({
      employmentType: "Internship / Full-time",
      programKeys: ["internship"],
    }));
    const insert = calls.find((call) => call.sql.includes("'program:' ||"));
    expect(JSON.parse(String(insert?.values[0]))).toEqual([
      expect.objectContaining({ programKey: "internship", evidence: "employment_type:internship" }),
    ]);
  });

  it("indexes an inferred recruiting year for a US internship posted in the prior fall", async () => {
    const { db, calls } = fakeDb();
    const store = new D1CrawlStore(db);
    const job = {
      externalId: "R67461", title: "Supply Chain Applied AI Engineering Intern", company: "Motorola Solutions",
      location: "Chicago, IL", locationCountry: "United States", arrangement: "onsite" as const,
      employmentType: "Internship; Full time", summary: null,
      officialUrl: "https://motorolasolutions.wd5.myworkdayjobs.com/Careers/job/Chicago-IL/Supply-Chain-Applied-AI-Engineering-Intern_R67461",
      publishedAt: "2026-08-07T00:00:00.000Z",
    } as CrawledJob;

    await store.syncJobs("legacy-row-839", [job], false);

    const jobsInsert = calls.find((call) => call.sql.includes("INSERT INTO jobs"));
    expect(JSON.parse(String(jobsInsert?.values[0]))[0]).toEqual(expect.objectContaining({
      recruitingYears: [2027],
      recruitingYearEvidence: expect.objectContaining({ 2027: "inferred:us-program-posted-h2" }),
    }));
    expect(calls.some((call) => call.sql.includes("topic_key LIKE 'year:%'"))).toBe(true);
    const insert = calls.find((call) => call.sql.includes("'year:' ||"));
    expect(JSON.parse(String(insert?.values[0]))).toEqual([
      expect.objectContaining({ year: 2027, evidence: "inferred:us-program-posted-h2" }),
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

  it("closes known navigation artifacts even when the replacement listing is incomplete", async () => {
    const { db, calls } = fakeDb({
      existingJobs: [{
        id: "fake-home", external_id: null, title: "Home",
        official_url: "https://careers.example/home", status: "open", resume_match_hash: null,
      }, {
        id: "fake-saved", external_id: null, title: "Saved Jobs 0",
        official_url: "https://careers.example/saved-jobs", status: "open", resume_match_hash: null,
      }, {
        id: "real", external_id: "REQ-1", title: "Home Lending Advisor",
        official_url: "https://careers.example/jobs/REQ-1", status: "open", resume_match_hash: null,
      }],
    });
    const store = new D1CrawlStore(db);

    const result = await store.syncJobs("source-1", [], false);

    const close = calls.find((call) => call.sql.includes("SET status = 'closed'"));
    expect(JSON.parse(String(close?.values[2]))).toEqual([
      "https://careers.example/home",
      "https://careers.example/saved-jobs",
    ]);
    expect(result.closed).toBe(2);
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
  it("promotes a discovered listing URL only while the original URL is still current", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return { run: async () => ({ meta: { changes: 1 } }) };
          },
        };
      },
    } as unknown as D1Database;

    await new D1CrawlStore(db).updateResolvedListing(
      "source-1",
      "https://acme.example/careers",
      "https://acme.example/jobs",
      "custom",
    );

    expect(calls[0].sql).toContain("WHERE id = ? AND posting_url = ?");
    expect(calls[0].values).toEqual([
      "https://acme.example/jobs",
      "custom",
      "source-1",
      "https://acme.example/careers",
    ]);
  });

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

  it("hydrates Google's bounded page checkpoint from catalog state", async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return { all: async () => ({ results: sql.includes("UPDATE sources") ? [{
              id: "p4-0285-google", company: "Google / Alphabet",
              posting_url: "https://www.google.com/about/careers/applications/jobs/results/",
              adapter: "custom", next_crawl_at: "2026-08-09T12:10:00.000Z",
            }] : [{
              key: "crawl_page_checkpoint:p4-0285-google",
              value: JSON.stringify({
                nextPage: 41,
                cycleStartedAt: "2026-08-09T08:00:00.000Z",
                previousCycleStartedAt: "2026-08-08T08:00:00.000Z",
              }),
            }] }) };
          },
        };
      },
    } as unknown as D1Database;

    await expect(new D1CrawlStore(db).dueSources("2026-08-09T12:00:00.000Z", 1)).resolves.toEqual([
      expect.objectContaining({
        crawlPageCursor: 41,
        crawlCycleStartedAt: "2026-08-09T08:00:00.000Z",
        crawlPreviousCycleStartedAt: "2026-08-08T08:00:00.000Z",
      }),
    ]);
  });

  it("leases only explicitly requested sources for targeted recovery", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return { all: async () => ({ results: sql.includes("UPDATE sources") ? [{
              id: "repair-me", company: "Acme", posting_url: "https://example.com/jobs",
              adapter: "custom", next_crawl_at: String(values[0]),
            }] : [] }) };
          },
        };
      },
    } as unknown as D1Database;

    const sources = await new D1CrawlStore(db).sourcesByIds(
      ["repair-me", "repair-me-too"],
      "2026-08-12T00:00:00.000Z",
    );

    expect(sources).toEqual([expect.objectContaining({ id: "repair-me" })]);
    expect(calls[0].sql).toContain("id IN (SELECT value FROM json_each(?))");
    expect(calls[0].sql).not.toContain("next_crawl_at <=");
    expect(calls[0].values).toEqual([
      "2026-08-12T00:10:00.000Z",
      JSON.stringify(["repair-me", "repair-me-too"]),
    ]);
  });

  it("persists page cycles and closes stale rows only after two completed cycles", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return { run: async () => ({ meta: { changes: sql.includes("UPDATE jobs") ? 3 : 1 } }) };
          },
        };
      },
    } as unknown as D1Database;
    const store = new D1CrawlStore(db);

    await expect(store.advancePagedCrawl("p4-0285-google", {
      nextPage: 41, cycleComplete: false, totalPages: 178,
    }, "2026-08-09T08:00:00.000Z", null)).resolves.toEqual({ closed: 0 });
    await expect(store.advancePagedCrawl("p4-0285-google", {
      nextPage: 1, cycleComplete: true, totalPages: 178,
    }, "2026-08-09T08:00:00.000Z", null)).resolves.toEqual({ closed: 0 });
    await expect(store.advancePagedCrawl("p4-0285-google", {
      nextPage: 1, cycleComplete: true, totalPages: 178,
    }, "2026-08-10T08:00:00.000Z", "2026-08-09T08:00:00.000Z")).resolves.toEqual({ closed: 3 });

    expect(calls[0].sql).toContain("INSERT INTO catalog_state");
    expect(calls[1].sql).toContain("INSERT INTO catalog_state");
    expect(calls[2].sql).toContain("last_seen_at < ?");
    expect(calls[2].values[2]).toBe("2026-08-09T08:00:00.000Z");
    expect(calls[3].sql).toContain("INSERT INTO catalog_state");
  });
});
