import { describe, expect, it } from "vitest";
import { validateExplicitJobFilterValues } from "./job-filter-validation";

describe("explicit job-filter validation", () => {
  it.each([
    ["page", "page=2&page=invalid"],
    ["pageSize", "pageSize=25&pageSize=101"],
    ["salaryMin", "salaryMin=100000&salaryMin=invalid"],
    ["salaryMax", "salaryMax=200000&salaryMax=-1"],
    ["postedAfter", "postedAfter=2026-01-01&postedAfter=invalid"],
    ["postedBefore", "postedBefore=2026-12-31&postedBefore=2026-02-30"],
  ])("rejects every explicitly supplied %s value", (name, query) => {
    expect(() => validateExplicitJobFilterValues(new URLSearchParams(query)))
      .toThrow(`Invalid ${name}.`);
  });
});
