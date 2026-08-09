import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { queryJobFilterOptions } from "./job-filter-options";

const schema = `
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    title TEXT NOT NULL,
    location TEXT,
    location_city TEXT,
    location_state TEXT,
    location_country TEXT,
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
`;

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
      "new", "Acme", "2027 Software Intern Co-op", "New York, NY", "New York", "NY", "US",
      "remote", "internship", "Engineering", '["TypeScript","SQL"]', '["English"]',
      "https://example.com/jobs/1", "open", "2026-02-01", "x".repeat(1_000_000),
    );
    insert.run(
      "closed", "Closed Co", "2027 Finance Intern", "Boston, MA", "Boston", "MA", "US",
      "hybrid", "internship", "Finance", "not-json", "not-json",
      "https://example.com/jobs/closed", "closed", "2026-02-01", "x".repeat(1_000_000),
    );

    for (let index = 1; index <= 101; index += 1) {
      const suffix = String(index).padStart(3, "0");
      insert.run(
        `company-${suffix}`, `Company ${suffix}`, "Regular role", null, null, null, null,
        null, index === 1 ? "Phoenix" : index === 2 ? "Full-Time" : null, null, "not-json", "not-json",
        `https://example.com/jobs/company-${suffix}`, "open", "2026-03-01", "x".repeat(20_000),
      );
    }

    const d1 = {
      prepare(sql: string) {
        return {
          async all<T>() {
            if ((sql.match(/UNION ALL/g) ?? []).length > 5) {
              throw new Error("D1_ERROR: too many terms in compound SELECT: SQLITE_ERROR");
            }
            return { results: sqlite.prepare(sql).all() as T[] };
          },
        };
      },
    } as unknown as D1Database;

    const options = await queryJobFilterOptions(d1);

    expect(options.companies).toHaveLength(100);
    expect(options.companies).toContainEqual({ value: "Acme", count: 1 });
    expect(options.companies).not.toContainEqual(expect.objectContaining({ value: "Closed Co" }));
    expect(options.recruitingYears).toEqual([{ value: 2027, count: 1 }]);
    expect(options.programTypes).toEqual(expect.arrayContaining([
      { value: "internship", count: 1 },
      { value: "coop", count: 1 },
    ]));
    expect(options.skills).toEqual(expect.arrayContaining([
      { value: "SQL", count: 1 },
      { value: "TypeScript", count: 1 },
    ]));
    expect(options.languages).toEqual([{ value: "English", count: 1 }]);
    expect(options.employmentTypes).toContainEqual({ value: "Full-Time", count: 1 });
    expect(options.employmentTypes).toContainEqual({ value: "internship", count: 1 });
    expect(options.employmentTypes).not.toContainEqual(expect.objectContaining({ value: "Phoenix" }));
    sqlite.close();
  });
});
