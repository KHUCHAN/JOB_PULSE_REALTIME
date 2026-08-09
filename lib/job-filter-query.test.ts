import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  defaultJobFilters,
  parseJobFilterParams,
  serializeJobFilters,
} from "./job-filter-query";

describe("job filter query codec", () => {
  it("round-trips multi-value structured filters", () => {
    const filters = parseJobFilterParams(new URLSearchParams(
      "year=2027&program=internship&program=coop&company=SpaceX&skill=Python&page=3",
    ));

    expect(filters.recruitingYears).toEqual([2027]);
    expect(filters.programTypes).toEqual(["internship", "coop"]);
    expect(filters.companies).toEqual(["SpaceX"]);
    expect(filters.skills).toEqual(["Python"]);
    expect(serializeJobFilters(filters).toString()).toContain("page=3");
  });

  it("drops invalid numeric, date, and enum values", () => {
    const filters = parseJobFilterParams(new URLSearchParams(
      "year=nope&program=contract&page=-1&pageSize=999&postedAfter=tomorrow",
    ));

    expect(filters).toMatchObject({
      recruitingYears: [],
      programTypes: [],
      page: 1,
      pageSize: 50,
      postedAfter: "",
    });
  });

  it("normalizes comma-separated repeated values and bounded ranges", () => {
    const filters = parseJobFilterParams(new URLSearchParams(
      "year=1999,2027,2101,2027&program=internship,coop&program=internship&salaryMin=-1&salaryMax=85000",
    ));

    expect(filters.recruitingYears).toEqual([2027]);
    expect(filters.programTypes).toEqual(["internship", "coop"]);
    expect(filters.salaryMin).toBeUndefined();
    expect(filters.salaryMax).toBe(85000);
  });

  it("serializes non-default fields in a canonical fixed order", () => {
    const params = serializeJobFilters({
      ...defaultJobFilters,
      companies: ["SpaceX"],
      recruitingYears: [2027],
      programTypes: ["internship", "coop"],
      skills: ["Python"],
      page: 3,
    });

    expect(params.toString()).toBe(
      "company=SpaceX&year=2027&program=internship&program=coop&skill=Python&page=3",
    );
  });

  it("counts each active field once and ignores pagination", () => {
    expect(activeFilterCount({
      ...defaultJobFilters,
      companies: ["SpaceX", "NASA"],
      recruitingYears: [2027],
      page: 4,
    })).toBe(2);
  });

  it("omits invalid direct pagination and salary values during serialization", () => {
    const params = serializeJobFilters({
      ...defaultJobFilters,
      page: 1.5,
      pageSize: 101,
      salaryMin: -1,
      salaryMax: Infinity,
    });

    expect(params.toString()).toBe("");
  });
});
