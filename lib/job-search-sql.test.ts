import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { defaultJobFilters } from "./job-filter-query";
import { buildJobSearchPlan } from "./job-search-sql";

const sqliteLiteral = (value: unknown): string => typeof value === "number"
  ? String(value)
  : `'${String(value).replaceAll("'", "''")}'`;

const executePlan = (sql: string, bindings: unknown[], limit?: number, offset?: number): unknown[] => {
  const parameters = [...bindings, ...(limit === undefined ? [] : [limit, offset ?? 0])]
    .map((value, index) => `.parameter set ?${index + 1} ${sqliteLiteral(value)}`)
    .join("\n");
  const output = execFileSync("sqlite3", ["-json", "-batch", ":memory:"], {
    encoding: "utf8",
    input: [
      `CREATE TABLE jobs (
        id TEXT NOT NULL, source_id TEXT NOT NULL DEFAULT 'source', company TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'Role', location TEXT, arrangement TEXT NOT NULL DEFAULT 'onsite',
        summary TEXT, official_url TEXT NOT NULL, status TEXT NOT NULL, first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL DEFAULT '2026-08-09T00:00:00.000Z', review_state TEXT,
        employment_type TEXT, description TEXT, responsibilities TEXT, qualifications TEXT, skills TEXT,
        department TEXT, team TEXT, business_unit TEXT, job_family TEXT, job_function TEXT, industry TEXT,
        office TEXT, secondary_locations TEXT, location_city TEXT, location_state TEXT, location_country TEXT,
        location_region TEXT,
        location_postal_code TEXT, latitude REAL, longitude REAL, salary_min REAL, salary_max REAL,
        salary_currency TEXT, salary_interval TEXT, benefits TEXT, education_requirements TEXT,
        experience_requirements TEXT, experience_level TEXT, shift_schedule TEXT, travel_requirements TEXT,
        security_clearance TEXT, languages TEXT, requisition_id TEXT, apply_url TEXT, source_posted_text TEXT,
        source_updated_at TEXT, valid_through TEXT, published_at TEXT, raw_payload TEXT
      );`,
      "CREATE TABLE job_topics (job_id TEXT, topic_key TEXT, PRIMARY KEY(job_id, topic_key));",
      "INSERT INTO jobs (id, company, official_url, status, first_seen_at, published_at, valid_through) VALUES ('older-duplicate', 'Acme, Inc.', 'https://acme.example/jobs/1', 'open', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', NULL), ('newer-duplicate', 'Acme, Inc.', 'https://acme.example/jobs/1', 'open', '2026-08-03T00:00:00.000Z', '2026-08-01T00:00:00.000Z', NULL), ('second-page', 'Acme, Inc.', 'https://acme.example/jobs/2', 'open', '2026-08-02T00:00:00.000Z', '2026-08-10T00:00:00.000Z', NULL), ('not-a-match', 'Acme', 'https://acme.example/jobs/3', 'open', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z', NULL), ('expired', 'Acme, Inc.', 'https://acme.example/jobs/4', 'open', '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z', '2000-01-01'), ('known-posted-date', 'Date Order Inc.', 'https://date.example/jobs/known', 'open', '2026-08-01T00:00:00.000Z', '2026-08-14T00:00:00.000Z', NULL), ('unknown-posted-date', 'Date Order Inc.', 'https://date.example/jobs/unknown', 'open', '2026-08-15T00:00:00.000Z', NULL, NULL);",
      ".parameter init",
      parameters,
      `${sql};`,
    ].join("\n"),
  });
  return JSON.parse(output) as unknown[];
};

describe("parameterized job search SQL", () => {
  it("uses the topic membership index and composes with 2027 internship filters", () => {
    const plan = buildJobSearchPlan({
      ...defaultJobFilters,
      topics: ["ai-data"],
      recruitingYears: [2027],
      programTypes: ["internship"],
    });
    const parameters = plan.bindings.map((value, index) =>
      `.parameter set ?${index + 1} ${sqliteLiteral(value)}`,
    ).join("\n");
    const output = execFileSync("sqlite3", ["-json", "-batch", ":memory:"], {
      encoding: "utf8",
      input: [
        `CREATE TABLE jobs (
          id TEXT PRIMARY KEY, company TEXT, title TEXT, official_url TEXT, status TEXT, first_seen_at TEXT,
          valid_through TEXT, employment_type TEXT
        );`,
        "CREATE TABLE job_topics (job_id TEXT, topic_key TEXT, PRIMARY KEY(job_id, topic_key));",
        "CREATE INDEX job_topics_topic_job_idx ON job_topics(topic_key, job_id);",
        `INSERT INTO jobs VALUES
          ('ai-intern','Acme','2027 Machine Learning Intern','https://e/1','open','2026-01-03',NULL,NULL),
          ('finance-intern','Acme','2027 Finance Intern','https://e/2','open','2026-01-02',NULL,NULL),
          ('ai-regular','Acme','2026 Data Scientist','https://e/3','open','2026-01-01',NULL,NULL);`,
        "INSERT INTO job_topics VALUES ('ai-intern','ai-data'),('ai-regular','ai-data'),('ai-intern','program:internship');",
        ".parameter init",
        parameters,
        `${plan.countSql};`,
        `EXPLAIN QUERY PLAN ${plan.countSql};`,
      ].join("\n"),
    });

    expect(plan.pageSql).toContain("job_topics");
    expect(plan.pageSql).toContain("FROM job_topics selected_topic INDEXED BY job_topics_topic_job_idx");
    expect(plan.pageSql).not.toContain("j.id IN (SELECT job_id FROM job_topics");
    expect(plan.bindings).toEqual(["ai-data", "program:internship"]);
    expect(output).toContain('"total":1');
    expect(output).toContain("job_topics_topic_job_idx");
  });

  it("uses indexed program memberships for 2027 internship and co-op predicates", () => {
    const plan = buildJobSearchPlan({
      ...defaultJobFilters,
      recruitingYears: [2027],
      programTypes: ["internship", "coop"],
    });

    expect(plan.pageSql).toContain("% 2027 %");
    expect(plan.pageSql).toContain("job_topics");
    expect(plan.pageSql).toContain("job_topics_topic_job_idx");
    expect(plan.bindings).toEqual(["program:internship", "program:coop"]);
  });

  it("uses indexed OR area memberships and direct region equality", () => {
    const plan = buildJobSearchPlan({
      ...defaultJobFilters,
      recruitingYears: [2027],
      programTypes: ["internship", "coop"],
      areas: ["ai-ml", "data-analytics", "software-engineering"],
      regions: ["us"],
    });

    expect(plan.pageSql).toContain("FROM job_topics selected_area INDEXED BY job_topics_topic_job_idx");
    expect(plan.pageSql).toContain("selected_area.topic_key IN (?, ?, ?)");
    expect(plan.pageSql).toContain("j.location_region = ?");
    expect(plan.pageSql).not.toContain("lower(j.location_region)");
    expect(plan.bindings).toEqual([
      "area:ai-ml", "area:data-analytics", "area:software-engineering", "us",
      "program:internship", "program:coop",
    ]);
  });

  it("matches recruiting-year memberships when the title omits the year", () => {
    const plan = buildJobSearchPlan({
      ...defaultJobFilters,
      recruitingYears: [2027],
      programTypes: ["internship"],
    });
    const output = execFileSync("sqlite3", ["-json", "-batch", ":memory:"], {
      encoding: "utf8",
      input: [
        "CREATE TABLE jobs (id TEXT, company TEXT, title TEXT, official_url TEXT, status TEXT, first_seen_at TEXT, valid_through TEXT, employment_type TEXT);",
        "CREATE TABLE job_topics (job_id TEXT, topic_key TEXT, PRIMARY KEY(job_id, topic_key));",
        "CREATE INDEX job_topics_topic_job_idx ON job_topics(topic_key, job_id);",
        "INSERT INTO jobs VALUES ('motorola','Motorola Solutions','Supply Chain Applied AI Engineering Intern','https://e/R67461','open','2026-08-07',NULL,NULL);",
        "INSERT INTO job_topics VALUES ('motorola','program:internship'),('motorola','year:2027');",
        ".parameter init",
        ...plan.bindings.map((value, index) => `.parameter set ?${index + 1} ${sqliteLiteral(value)}`),
        `${plan.countSql};`,
      ].join("\n"),
    });

    expect(plan.pageSql).toContain("year:2027");
    expect(JSON.parse(output)).toEqual([{ total: 1 }]);
  });

  it("does not let a stale topic override a conflicting explicit title year", () => {
    const plan = buildJobSearchPlan({
      ...defaultJobFilters,
      recruitingYears: [2027],
      programTypes: ["internship"],
    });
    const output = execFileSync("sqlite3", ["-json", "-batch", ":memory:"], {
      encoding: "utf8",
      input: [
        "CREATE TABLE jobs (id TEXT, company TEXT, title TEXT, official_url TEXT, status TEXT, first_seen_at TEXT, valid_through TEXT, employment_type TEXT);",
        "CREATE TABLE job_topics (job_id TEXT, topic_key TEXT, PRIMARY KEY(job_id, topic_key));",
        "CREATE INDEX job_topics_topic_job_idx ON job_topics(topic_key, job_id);",
        `INSERT INTO jobs VALUES
          ('conflict','Target','Current Interns Only ETL G194 Summer 2026 Intern Posting','https://e/2026','open','2026-08-18',NULL,'Internship'),
          ('topic-only','Motorola Solutions','Supply Chain Applied AI Engineering Intern','https://e/2027','open','2026-08-18',NULL,'Internship');`,
        `INSERT INTO job_topics VALUES
          ('conflict','program:internship'),('conflict','year:2027'),
          ('topic-only','program:internship'),('topic-only','year:2027');`,
        ".parameter init",
        ...plan.bindings.map((value, index) => `.parameter set ?${index + 1} ${sqliteLiteral(value)}`),
        `${plan.countSql};`,
      ].join("\n"),
    });

    expect(JSON.parse(output)).toEqual([{ total: 1 }]);
  });

  it("uses json_each for skill and language membership", () => {
    const plan = buildJobSearchPlan({
      ...defaultJobFilters,
      skills: ["Python"],
      languages: ["English"],
    });

    expect(plan.pageSql).toContain("json_each(j.skills)");
    expect(plan.pageSql).toContain("json_each(j.languages)");
  });

  it("combines multi-value fields with OR and different fields with AND", () => {
    const plan = buildJobSearchPlan({
      ...defaultJobFilters,
      companies: ["Acme", "Globex"],
      cities: ["Seattle"],
      salaryMin: 100_000,
      salaryMax: 160_000,
      page: 3,
      pageSize: 25,
    });

    expect(plan.pageSql).toMatch(/\(j\.company = \? COLLATE NOCASE OR j\.company = \? COLLATE NOCASE\)/);
    expect(plan.pageSql).toContain("j.location_city = ? COLLATE NOCASE");
    expect(plan.pageSql).toContain("j.salary_max >= ?");
    expect(plan.pageSql).toContain("j.salary_min <= ?");
    expect(plan.bindings).toEqual(["Acme", "Globex", "Seattle", 100_000, 160_000]);
    expect(plan.limit).toBe(25);
    expect(plan.offset).toBe(50);
  });

  it("uses the same search predicates for page and total queries", () => {
    const plan = buildJobSearchPlan({
      ...defaultJobFilters,
      query: "fraud risk",
      status: "saved",
    });

    for (const sql of [plan.pageSql, plan.countSql]) {
      expect(sql).toContain("jobs_fts MATCH ?");
      expect(sql).toContain("j.review_state = ?");
    }
    expect(plan.bindings).toEqual(['"fraud"* AND "risk"*', "saved"]);
  });

  it("deduplicates before filtering and uses an explicit projection", () => {
    const plan = buildJobSearchPlan(defaultJobFilters);

    expect(plan.pageSql).toContain("NOT EXISTS");
    expect(plan.pageSql).not.toContain("SELECT j.*");
    expect(plan.pageSql).not.toContain("raw_payload");
    expect(plan.pageSql).not.toContain("AS description");
    expect(plan.pageSql).toContain("AS summary");
    expect(plan.pageSql).toContain("j.employment_type AS employment_type");
    expect(plan.pageSql).toContain("j.published_at AS published_at");
    expect(plan.pageSql).toContain("j.location_region AS location_region");
    expect(plan.pageSql).toContain("AS area_keys");
    expect(plan.countSql).toContain("count(*)");
    expect(plan.countSql).not.toContain("row_number() OVER");
  });

  it("applies filters only to the canonical latest open row", () => {
    const setup = buildJobSearchPlan({ ...defaultJobFilters, companies: ["Older Co"] });
    const sql = setup.countSql.replace("FROM jobs j", `FROM jobs j`);
    const parameters = setup.bindings.map((value, index) =>
      `.parameter set ?${index + 1} ${sqliteLiteral(value)}`,
    ).join("\n");
    const output = execFileSync("sqlite3", ["-json", "-batch", ":memory:"], {
      encoding: "utf8",
      input: [
        "CREATE TABLE jobs (id TEXT, company TEXT, official_url TEXT, status TEXT, first_seen_at TEXT, valid_through TEXT, employment_type TEXT);",
        "INSERT INTO jobs VALUES ('old','Older Co','https://example.com/1','open','2026-01-01',NULL,NULL),('new','Newer Co','https://example.com/1','open','2026-02-01',NULL,NULL);",
        ".parameter init",
        parameters,
        `${sql};`,
      ].join("\n"),
    });

    expect(JSON.parse(output)).toEqual([{ total: 0 }]);
  });

  it("uses boundary-aware title tokens and direct ISO date/index predicates", () => {
    const plan = buildJobSearchPlan({
      ...defaultJobFilters,
      companies: ["Acme, Inc."],
      recruitingYears: [2027],
      programTypes: ["internship", "coop"],
      postedAfter: "2026-08-01",
      postedBefore: "2026-08-09",
    });

    expect(plan.pageSql).toContain("j.company = ? COLLATE NOCASE");
    expect(plan.pageSql).not.toContain("lower(j.company)");
    expect(plan.pageSql).toContain("j.published_at >= ?");
    expect(plan.pageSql).toContain("j.published_at < ?");
    expect(plan.pageSql).not.toContain("date(j.published_at)");
    expect(plan.bindings).toEqual(expect.arrayContaining([
      "Acme, Inc.", "2026-08-01", "2026-08-10",
    ]));
  });

  it("matches exact 2027 intern and all co-op spellings without internal/international false positives", () => {
    const count = (program: "internship" | "coop") => {
      const plan = buildJobSearchPlan({
        ...defaultJobFilters,
        recruitingYears: [2027],
        programTypes: [program],
      });
      const output = execFileSync("sqlite3", ["-json", "-batch", ":memory:"], {
        encoding: "utf8",
        input: [
          "CREATE TABLE jobs (id TEXT, company TEXT, title TEXT, official_url TEXT, status TEXT, first_seen_at TEXT, valid_through TEXT, employment_type TEXT);",
          "CREATE TABLE job_topics (job_id TEXT, topic_key TEXT, PRIMARY KEY(job_id, topic_key));",
          "CREATE INDEX job_topics_topic_job_idx ON job_topics(topic_key, job_id);",
          `INSERT INTO jobs VALUES
            ('intern','A','2027 Software Intern','https://e/1','open','2026-01-01',NULL,NULL),
            ('internship','A','2027 Product Internship','https://e/2','open','2026-01-01',NULL,NULL),
            ('internal','A','2027 Internal Audit','https://e/3','open','2026-01-01',NULL,NULL),
            ('international','A','2027 International Analyst','https://e/4','open','2026-01-01',NULL,NULL),
            ('hyphen','A','2027 Finance Co-op','https://e/5','open','2026-01-01',NULL,NULL),
            ('space','A','2027 Product Co Op','https://e/6','open','2026-01-01',NULL,NULL),
            ('joined','A','2027 Engineering Coop','https://e/7','open','2026-01-01',NULL,NULL),
            ('year-boundary','A','12027 Software Intern','https://e/8','open','2026-01-01',NULL,NULL),
            ('ibm-detail-coop','IBM','Data Engineer Intern 2027','https://careers.ibm.com/en_US/careers/JobDetail?jobId=128639','open','2026-01-01',NULL,'Internship');`,
          `INSERT INTO job_topics VALUES
            ('intern','program:internship'),
            ('internship','program:internship'),
            ('hyphen','program:coop'),
            ('space','program:coop'),
            ('joined','program:coop'),
            ('year-boundary','program:internship'),
            ('ibm-detail-coop','program:internship');`,
          ".parameter init",
          ...plan.bindings.map((value, index) => `.parameter set ?${index + 1} ${sqliteLiteral(value)}`),
          `${plan.countSql};`,
        ].join("\n"),
      });
      return JSON.parse(output) as Array<{ total: number }>;
    };

    expect(count("internship")).toEqual([{ total: 2 }]);
    expect(count("coop")).toEqual([{ total: 3 }]);
  });

  it("treats free-text location wildcard characters literally", () => {
    const plan = buildJobSearchPlan({
      ...defaultJobFilters,
      location: "100%_remote",
    });

    expect(plan.pageSql).toContain("LIKE ? ESCAPE '\\'");
    expect(plan.bindings).toEqual(["%100\\%\\_remote%"]);
  });

  it("orders comma-containing company selections by posted date across deduplicated pages", () => {
    const filters = {
      ...defaultJobFilters,
      companies: ["Acme, Inc."],
      pageSize: 1,
    };
    const firstPage = buildJobSearchPlan({ ...filters, page: 1 });
    const secondPage = buildJobSearchPlan({
      ...filters,
      page: 2,
    });

    expect(executePlan(firstPage.pageSql, firstPage.bindings, firstPage.limit, firstPage.offset))
      .toMatchObject([{ id: "second-page" }]);
    expect(executePlan(secondPage.pageSql, secondPage.bindings, secondPage.limit, secondPage.offset))
      .toMatchObject([{ id: "newer-duplicate" }]);
    expect(executePlan(firstPage.countSql, firstPage.bindings)).toEqual([{ total: 2 }]);
    expect(firstPage.pageSql).toContain("j.status = 'open'");
    expect(firstPage.pageSql).toContain("j.valid_through IS NULL OR j.valid_through >= date('now')");
  });

  it("matches free-text equality filters case-insensitively", () => {
    const plan = buildJobSearchPlan({
      ...defaultJobFilters,
      companies: ["acme, inc."],
    });

    expect(executePlan(plan.countSql, plan.bindings)).toEqual([{ total: 2 }]);
    expect(plan.pageSql).toContain("j.company = ? COLLATE NOCASE");
  });

  it("treats the Barclays brand and the legacy Barclays US source label as equivalent", () => {
    const brandPlan = buildJobSearchPlan({
      ...defaultJobFilters,
      companies: ["Barclays"],
    });
    const legacyPlan = buildJobSearchPlan({
      ...defaultJobFilters,
      companies: ["Barclays US"],
    });

    expect(brandPlan.bindings).toEqual(["Barclays", "Barclays US"]);
    expect(legacyPlan.bindings).toEqual(["Barclays", "Barclays US"]);
    expect(brandPlan.pageSql).toContain(
      "(j.company = ? COLLATE NOCASE OR j.company = ? COLLATE NOCASE)",
    );
  });

  it("ranks known official posting dates ahead of newly discovered unknown dates", () => {
    const plan = buildJobSearchPlan({
      ...defaultJobFilters,
      companies: ["Date Order Inc."],
    });

    expect(executePlan(plan.pageSql, plan.bindings, plan.limit, plan.offset))
      .toMatchObject([{ id: "known-posted-date" }, { id: "unknown-posted-date" }]);
    expect(plan.pageSql).toContain("ORDER BY j.published_at IS NULL ASC, j.published_at DESC");
  });

  it("filters active matches and orders by posting freshness before score", () => {
    const plan = buildJobSearchPlan({
      ...defaultJobFilters,
      resumeMatchProfile: "chanyoung-resume",
      regions: ["us"],
      programTypes: ["internship", "coop"],
    });

    expect(plan.pageSql).toContain("resume_match.is_active = 1");
    expect(plan.pageSql).toContain("resume_match.open_generation = j.open_generation");
    expect(plan.pageSql).toContain("ORDER BY j.published_at IS NULL ASC, j.published_at DESC, resume_match.score DESC, j.first_seen_at DESC");
    expect(plan.pageSql).toContain("resume_match.score AS resume_match_score");
    expect(plan.bindings).toContain("chanyoung-resume");
  });
});
