import { describe, expect, it } from "vitest";
import { ftsQuery, jobIdentifierQuery } from "./job-search";

describe("job full-text query", () => {
  it("does not expand short acronyms across the whole catalog", () => {
    expect(ftsQuery("R AI ML engineer")).toBe('"r" AND "ai" AND "ml" AND "engineer"*');
  });

  it("recognizes requisitions without misclassifying recruiting years or prose", () => {
    expect(jobIdentifierQuery(" R-284879 ")).toEqual(["R-284879", "R284879"]);
    expect(jobIdentifierQuery("94172495052972742")).toEqual(["94172495052972742"]);
    expect(jobIdentifierQuery("2027")).toBeUndefined();
    expect(jobIdentifierQuery("2027 AI intern")).toBeUndefined();
    expect(jobIdentifierQuery("R-284879' OR 1=1")).toBeUndefined();
  });
  it("requires every normalized search token", () => {
    expect(ftsQuery("fraud risk")).toBe('"fraud"* AND "risk"*');
  });

  it("escapes quotes and ignores punctuation-only input", () => {
    expect(ftsQuery('staff "engineer"')).toBe('"staff"* AND "engineer"*');
    expect(ftsQuery("---")).toBe("");
  });
});
