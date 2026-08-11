import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  jobFilterOptionRefreshKeys,
  queryCachedJobFilterOptions,
  queryJobFilterOptions,
  refreshJobFilterOptions,
  rotatingJobFilterOptionKeys,
} from "./job-filter-options";

const schema = `
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    title TEXT NOT NULL,
    location TEXT,
    location_city TEXT,
    location_state TEXT,
    location_country TEXT,
    location_region TEXT,
    arrangement TEXT,
    employment_type TEXT,
    department TEXT,
    team TEXT,
    business_unit TEXT,
    job_family TEXT,
    job_function TEXT,
    industry TEXT,
    office TEXT,
    skills TEXT,
    experience_level TEXT,
    salary_currency TEXT,
    salary_interval TEXT,
    education_requirements TEXT,
    shift_schedule TEXT,
    travel_requirements TEXT,
    security_clearance TEXT,
    languages TEXT,
    official_url TEXT NOT NULL,
    status TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    description TEXT
  );
  CREATE TABLE job_topics (
    job_id TEXT NOT NULL,
    topic_key TEXT NOT NULL,
    PRIMARY KEY (job_id, topic_key)
  );
`;

const createD1 = (
  sqlite: DatabaseSync,
  rejectLargeCompound = false,
  maxFilterKeysPerQuery = Number.POSITIVE_INFINITY,
): D1Database => {
  const statement = (sql: string, bindings: SQLInputValue[] = []) => ({
    bind: (...values: unknown[]) => statement(sql, values as SQLInputValue[]),
    async all<T>() {
      if (rejectLargeCompound && (sql.match(/UNION ALL/g) ?? []).length > 5) {
        throw new Error("D1_ERROR: too many terms in compound SELECT: SQLITE_ERROR");
      }
      const results = sqlite.prepare(sql).all(...bindings) as T[];
      const filterKeys = new Set(results.flatMap((row) => {
        if (typeof row !== "object" || row === null || !("filter_key" in row)) return [];
        return [String(row.filter_key)];
      }));
      if (sql.includes("FROM jobs") && filterKeys.size > maxFilterKeysPerQuery) {
        throw new Error("D1_ERROR: D1 DB exceeded its CPU time limit and was reset.");
      }
      return { results };
    },
    async first<T>() {
      return (sqlite.prepare(sql).get(...bindings) as T | undefined) ?? null;
    },
    async run() {
      sqlite.prepare(sql).run(...bindings);
      return { success: true };
    },
  });
  return {
    prepare: (sql: string) => statement(sql),
    async batch(statements: D1PreparedStatement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const prepared of statements) results.push(await prepared.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
};

describe("queryJobFilterOptions", () => {
  it("aggregates deduplicated open jobs in SQLite and returns at most 100 values per filter", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(schema);
    const insert = sqlite.prepare(`
      INSERT INTO jobs (
        id, company, title, location, location_city, location_state, location_country,
        arrangement, employment_type, department, skills, languages, official_url,
        status, first_seen_at, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      "old", "Acme", "2027 Software Intern", "New York, NY", "New York", "NY", "US",
      "remote", "internship", "Engineering", '["TypeScript"]', '["English"]',
      "https://example.com/jobs/1", "open", "2026-01-01", "x".repeat(1_000_000),
    );
    insert.run(
      "co-op-spaces", "Space Co", "2027 Product Co Op", null, null, null, null,
      null, "internship", null, "[]", "[]",
      "https://example.com/jobs/co-op-spaces", "open", "2026-02-02", null,
    );
    insert.run(
      "false-internal", "Audit Co", "Internal Audit 2027", null, null, null, null,
      null, "regular", null, "[]", "[]",
      "https://example.com/jobs/false-internal", "open", "2026-02-03", null,
    );
    insert.run(
      "false-international", "Global Co", "International Analyst 12027", null, null, null, null,
      null, "regular", null, "[]", "[]",
      "https://example.com/jobs/false-international", "open", "2026-02-04", null,
    );
    insert.run(
      "new", "Acme", "2027 Software Intern Co-op", "New York, NY", "New York", "NY", "US",
      "remote", "internship", "Engineering", '["TypeScript","SQL"]', '["English"]',
      "https://example.com/jobs/1", "open", "2026-02-01", "x".repeat(1_000_000),
    );
    insert.run(
      "closed", "Closed Co", "2027 Finance Intern", "Boston, MA", "Boston", "MA", "US",
      "hybrid", "internship", "Finance", "not-json", "not-json",
      "https://example.com/jobs/closed", "closed", "2026-02-01", "x".repeat(1_000_000),
    );
    sqlite.exec(`
      INSERT INTO job_topics VALUES
        ('old', 'program:internship'),
        ('co-op-spaces', 'program:coop'),
        ('new', 'program:internship'),
        ('new', 'program:coop'),
        ('closed', 'program:internship'),
        ('company-001', 'year:2027');
      UPDATE jobs SET location_region = 'us' WHERE location_country = 'US';
      UPDATE jobs SET location_region = 'unknown' WHERE location_region IS NULL;
    `);

    for (let index = 1; index <= 101; index += 1) {
      const suffix = String(index).padStart(3, "0");
      insert.run(
        `company-${suffix}`, `Company ${suffix}`, "Regular role", null, null, null, null,
        null, index === 1 ? "Phoenix" : index === 2 ? "Full-Time" : null, null, "not-json", "not-json",
        `https://example.com/jobs/company-${suffix}`, "open", "2026-03-01", "x".repeat(20_000),
      );
    }
    sqlite.exec("UPDATE jobs SET location_region = 'unknown' WHERE location_region IS NULL");

    const d1 = createD1(sqlite, true);

    const options = await queryJobFilterOptions(d1);

    expect(options.companies).toHaveLength(100);
    expect(options.companies).toContainEqual({ value: "Acme", count: 1 });
    expect(options.companies).not.toContainEqual(expect.objectContaining({ value: "Closed Co" }));
    expect(options.recruitingYears).toEqual([{ value: 2027, count: 4 }]);
    expect(options.programTypes).toEqual(expect.arrayContaining([
      { value: "internship", count: 1 },
      { value: "coop", count: 2 },
    ]));
    expect(options.skills).toEqual(expect.arrayContaining([
      { value: "SQL", count: 1 },
      { value: "TypeScript", count: 1 },
    ]));
    expect(options.languages).toEqual([{ value: "English", count: 1 }]);
    expect(options.employmentTypes).toContainEqual({ value: "Full-Time", count: 1 });
    expect(options.employmentTypes).toContainEqual({ value: "internship", count: 2 });
    expect(options.employmentTypes).not.toContainEqual(expect.objectContaining({ value: "Phoenix" }));
    expect(options.regions).toEqual(expect.arrayContaining([
      { value: "us", count: 1 },
      { value: "unknown", count: 104 },
    ]));
    sqlite.close();
  });

  it("serves a durable snapshot without recomputing every facet on a cold request", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(schema);
    sqlite.exec(`
      CREATE TABLE job_filter_options_cache (
        filter_key TEXT NOT NULL,
        normalized_value TEXT NOT NULL,
        value_label TEXT NOT NULL,
        job_count INTEGER NOT NULL,
        refreshed_at TEXT NOT NULL,
        PRIMARY KEY (filter_key, normalized_value)
      );
    `);
    const insert = sqlite.prepare(`
      INSERT INTO jobs (
        id, company, title, skills, languages, official_url, status, first_seen_at
      ) VALUES (?, ?, ?, '[]', '[]', ?, 'open', ?)
    `);
    insert.run("acme", "Acme", "Data Engineer", "https://example.com/acme", "2026-08-10");
    const d1 = createD1(sqlite);

    const first = await refreshJobFilterOptions(d1, { force: true });
    expect(first).toEqual(expect.objectContaining({ refreshed: true }));
    expect((await queryCachedJobFilterOptions(d1))?.companies).toContainEqual({ value: "Acme", count: 1 });

    insert.run("beta", "Beta", "ML Engineer", "https://example.com/beta", "2026-08-10");
    await expect(refreshJobFilterOptions(d1, {
      now: new Date("2099-01-01T00:00:00.000Z"),
      maxAgeMs: Number.MAX_SAFE_INTEGER,
    })).resolves.toEqual(expect.objectContaining({ refreshed: false }));
    expect((await queryCachedJobFilterOptions(d1))?.companies).not.toContainEqual(expect.objectContaining({ value: "Beta" }));

    await refreshJobFilterOptions(d1, { force: true });
    expect((await queryCachedJobFilterOptions(d1))?.companies).toContainEqual({ value: "Beta", count: 1 });
    sqlite.close();
  });

  it("refreshes the full snapshot while keeping each D1 aggregation to one facet", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(schema);
    sqlite.exec(`
      CREATE TABLE job_filter_options_cache (
        filter_key TEXT NOT NULL,
        normalized_value TEXT NOT NULL,
        value_label TEXT NOT NULL,
        job_count INTEGER NOT NULL,
        refreshed_at TEXT NOT NULL,
        PRIMARY KEY (filter_key, normalized_value)
      );
      INSERT INTO jobs (
        id, company, title, location_region, arrangement, employment_type,
        skills, languages, official_url, status, first_seen_at
      ) VALUES
        ('one', 'Acme', '2027 Software Engineering Intern', 'us', 'remote', 'Internship',
         '["TypeScript"]', '["English"]', 'https://example.com/one', 'open', '2026-08-10');
      INSERT INTO job_topics VALUES ('one', 'program:internship');
    `);
    const d1 = createD1(sqlite, false, 1);

    await expect(refreshJobFilterOptions(d1, {
      force: true,
      filterKeys: ["companies", "recruitingYears", "programTypes", "skills"],
    })).resolves.toEqual(
      expect.objectContaining({ refreshed: true }),
    );
    const cached = await queryCachedJobFilterOptions(d1);
    expect(cached?.companies).toEqual([{ value: "Acme", count: 1 }]);
    expect(cached?.recruitingYears).toEqual([{ value: 2027, count: 1 }]);
    expect(cached?.programTypes).toEqual([{ value: "internship", count: 1 }]);
    expect(cached?.skills).toEqual([{ value: "TypeScript", count: 1 }]);
    expect(cached?.languages).toEqual([]);
    sqlite.close();
  });

  it("bounds requested and automatic refreshes to four unique facet keys", () => {
    expect(jobFilterOptionRefreshKeys([
      "regions", "companies", "regions", "skills", "languages", "not-a-filter",
    ])).toEqual(["regions", "companies", "skills", "languages"]);
    expect(jobFilterOptionRefreshKeys(undefined)).toEqual([
      "companies", "locations", "cities", "states",
    ]);

    const first = rotatingJobFilterOptionKeys(new Date("2026-08-10T00:00:00.000Z"));
    const next = rotatingJobFilterOptionKeys(new Date("2026-08-10T02:00:00.000Z"));
    expect(first).toHaveLength(4);
    expect(next).toHaveLength(4);
    expect(next).not.toEqual(first);
    expect(new Set([...first, ...next]).size).toBe(8);
  });
});
