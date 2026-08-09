import { describe, expect, it, vi } from "vitest";
import { bindJobSearchStatements } from "./job-search-execution";

describe("job search execution", () => {
  it("binds count predicates without pagination and page predicates with pagination", () => {
    const pageStatement = { bind: vi.fn().mockReturnThis() };
    const countStatement = { bind: vi.fn().mockReturnThis() };
    const prepare = vi.fn()
      .mockReturnValueOnce(pageStatement)
      .mockReturnValueOnce(countStatement);

    bindJobSearchStatements(prepare, {
      pageSql: "PAGE",
      countSql: "COUNT",
      bindings: ["saved", "acme"],
      limit: 25,
      offset: 50,
    });

    expect(prepare).toHaveBeenNthCalledWith(1, "PAGE");
    expect(pageStatement.bind).toHaveBeenCalledWith("saved", "acme", 25, 50);
    expect(prepare).toHaveBeenNthCalledWith(2, "COUNT");
    expect(countStatement.bind).toHaveBeenCalledWith("saved", "acme");
  });
});
