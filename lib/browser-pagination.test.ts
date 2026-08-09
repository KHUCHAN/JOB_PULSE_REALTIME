import { describe, expect, it } from "vitest";
import { numericPaginationTargets } from "./browser-pagination";

describe("numericPaginationTargets", () => {
  it("selects pages two through five and ignores counts or distant page numbers", () => {
    expect(numericPaginationTargets(["1", "2", "3", "4", "5", "10", "50", "381", "Next"])).toEqual([2, 3, 4, 5]);
  });

  it("accepts accessible labels such as Page 2 without duplicating targets", () => {
    expect(numericPaginationTargets(["Page 2", "2", "page 3", "Page 5"])).toEqual([2, 3, 5]);
  });
});
