import { describe, expect, it } from "vitest";
import { validateExplicitJobFilterValues } from "./job-filter-validation";

describe("explicit job-filter validation", () => {
  it("rejects unknown topic keys without rejecting ai-data", () => {
    expect(() => validateExplicitJobFilterValues(new URLSearchParams("topic=ai-data"))).not.toThrow();
    expect(() => validateExplicitJobFilterValues(new URLSearchParams("topic=unknown")))
      .toThrow("Invalid topic.");
  });

  it("accepts only supported area and region keys", () => {
    expect(() => validateExplicitJobFilterValues(new URLSearchParams(
      "area=ai-ml&area=data-analytics&area=software-engineering&region=us&region=non_us&region=mixed&region=unknown",
    ))).not.toThrow();
    expect(() => validateExplicitJobFilterValues(new URLSearchParams("area=security")))
      .toThrow("Invalid area.");
    expect(() => validateExplicitJobFilterValues(new URLSearchParams("region=global")))
      .toThrow("Invalid region.");
  });

  it.each([
    ["page", "page=2&page=invalid"],
    ["pageSize", "pageSize=25&pageSize=101"],
    ["salaryMin", "salaryMin=100000&salaryMin=invalid"],
    ["salaryMax", "salaryMax=200000&salaryMax=-1"],
    ["postedAfter", "postedAfter=2026-01-01&postedAfter=invalid"],
    ["postedBefore", "postedBefore=2026-12-31&postedBefore=2026-02-30"],
    ["snapshotAt", "snapshotAt=2026-08-25T19%3A20%3A30.123Z&snapshotAt=tomorrow"],
  ])("rejects every explicitly supplied %s value", (name, query) => {
    expect(() => validateExplicitJobFilterValues(new URLSearchParams(query)))
      .toThrow(`Invalid ${name}.`);
  });

  it("accepts a UTC snapshot timestamp", () => {
    expect(() => validateExplicitJobFilterValues(new URLSearchParams(
      "snapshotAt=2026-08-25T19%3A20%3A30.123Z",
    ))).not.toThrow();
  });
});
