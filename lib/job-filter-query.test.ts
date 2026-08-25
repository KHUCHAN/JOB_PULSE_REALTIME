import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  defaultJobFilters,
  parseJobFilterParams,
  serializeJobFilters,
} from "./job-filter-query";

describe("job filter query codec", () => {
  it("round-trips the indexed AI/data topic as a repeated URL parameter", () => {
    const parsed = parseJobFilterParams(new URLSearchParams("topic=ai-data"));

    expect(parsed.topics).toEqual(["ai-data"]);
    expect(serializeJobFilters({ ...defaultJobFilters, topics: ["ai-data"] }).toString())
      .toBe("topic=ai-data");
    expect(activeFilterCount({ ...defaultJobFilters, topics: ["ai-data"] })).toBe(1);
  });

  it("round-trips explicit job areas and location regions", () => {
    const parsed = parseJobFilterParams(new URLSearchParams(
      "year=2027&program=internship&program=coop&area=ai-ml&area=data-analytics&area=software-engineering&region=us",
    ));

    expect(parsed.areas).toEqual(["ai-ml", "data-analytics", "software-engineering"]);
    expect(parsed.regions).toEqual(["us"]);
    expect(serializeJobFilters(parsed).getAll("area")).toEqual([
      "ai-ml", "data-analytics", "software-engineering",
    ]);
    expect(serializeJobFilters(parsed).getAll("region")).toEqual(["us"]);
    expect(activeFilterCount(parsed)).toBe(4);
  });

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

  it("round-trips comma-containing free-text facet values atomically", () => {
    const filters = {
      ...defaultJobFilters,
      companies: ["Bain & Company — AI, Insights & Solutions (AIS) / Bain Vector"],
      skills: ["C++, SQL"],
    };

    const parsed = parseJobFilterParams(serializeJobFilters(filters));

    expect(parsed.companies).toEqual(filters.companies);
    expect(parsed.skills).toEqual(filters.skills);
  });

  it("drops invalid numeric, date, and enum values", () => {
    const filters = parseJobFilterParams(new URLSearchParams(
      "year=nope&program=contract&area=security&region=global&page=-1&pageSize=999&postedAfter=tomorrow",
    ));

    expect(filters).toMatchObject({
      recruitingYears: [],
      programTypes: [],
      page: 1,
      pageSize: 50,
      postedAfter: "",
      areas: [],
      regions: [],
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

  it("omits invalid direct enum values and canonicalizes structured selections", () => {
    const params = serializeJobFilters({
      ...defaultJobFilters,
      status: "unknown" as never,
      arrangement: "flexible" as never,
      recruitingYears: [2027, 2027, 1999],
      programTypes: ["internship", "internship"],
      seasons: ["summer", "summer"],
    });

    expect(params.toString()).toBe("year=2027&program=internship&season=summer");
  });

  it("does not count malformed direct values as active filters", () => {
    expect(activeFilterCount({
      ...defaultJobFilters,
      status: "unknown" as never,
      arrangement: "flexible" as never,
      companies: [" "],
      recruitingYears: [1999],
      programTypes: ["contract" as never],
      seasons: ["monsoon" as never],
      postedAfter: "tomorrow",
      postedBefore: "2027-02-29",
      salaryMin: -1,
      salaryMax: Infinity,
    })).toBe(0);
  });

  it("round-trips the personal resume preset as an atomic profile id", () => {
    const filters = parseJobFilterParams(new URLSearchParams(
      "resumeMatch=chanyoung-resume&region=us&program=internship&program=coop",
    ));

    expect(filters.resumeMatchProfile).toBe("chanyoung-resume");
    expect(serializeJobFilters(filters).get("resumeMatch")).toBe("chanyoung-resume");
    expect(activeFilterCount(filters)).toBe(3);
  });

  it("round-trips a stable pagination snapshot timestamp", () => {
    const filters = parseJobFilterParams(new URLSearchParams(
      "page=2&snapshotAt=2026-08-25T19%3A20%3A30.123Z",
    ));

    expect(filters.snapshotAt).toBe("2026-08-25T19:20:30.123Z");
    expect(serializeJobFilters(filters).get("snapshotAt")).toBe("2026-08-25T19:20:30.123Z");
  });
});
