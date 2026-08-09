import { describe, expect, it } from "vitest";
import { defaultJobFilters } from "./job-filter-query";
import { buildJobSearchPlan } from "./job-search-sql";

describe("parameterized job search SQL", () => {
  it("builds title-only 2027 internship and co-op predicates", () => {
    const plan = buildJobSearchPlan({
      ...defaultJobFilters,
      recruitingYears: [2027],
      programTypes: ["internship", "coop"],
    });

    expect(plan.pageSql).toContain("lower(j.title)");
    expect(plan.pageSql).toContain("row_number() OVER (PARTITION BY j.official_url");
    expect(plan.bindings).toEqual(expect.arrayContaining(["%2027%", "%intern%", "%co-op%"]));
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

    expect(plan.pageSql).toMatch(/\(lower\(j\.company\) = \? OR lower\(j\.company\) = \?\)/);
    expect(plan.pageSql).toContain("lower(j.location_city) = ?");
    expect(plan.pageSql).toContain("j.salary_max >= ?");
    expect(plan.pageSql).toContain("j.salary_min <= ?");
    expect(plan.bindings).toEqual(["acme", "globex", "seattle", 100_000, 160_000]);
    expect(plan.limit).toBe(25);
    expect(plan.offset).toBe(50);
  });

  it("uses the same deduplicated ranked CTE for page and total queries", () => {
    const plan = buildJobSearchPlan({
      ...defaultJobFilters,
      query: "fraud risk",
      status: "saved",
    });

    const pageCte = plan.pageSql.slice(0, plan.pageSql.indexOf("SELECT ranked"));
    const countCte = plan.countSql.slice(0, plan.countSql.indexOf("SELECT count"));
    expect(pageCte).toBe(countCte);
    expect(plan.bindings).toEqual(['"fraud"* AND "risk"*', "saved"]);
  });

  it("treats free-text location wildcard characters literally", () => {
    const plan = buildJobSearchPlan({
      ...defaultJobFilters,
      location: "100%_remote",
    });

    expect(plan.pageSql).toContain("LIKE ? ESCAPE '\\'");
    expect(plan.bindings).toEqual(["%100\\%\\_remote%"]);
  });
});
