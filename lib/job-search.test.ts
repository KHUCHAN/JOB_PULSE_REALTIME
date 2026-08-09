import { describe, expect, it } from "vitest";
import { ftsQuery } from "./job-search";

describe("job full-text query", () => {
  it("requires every normalized search token", () => {
    expect(ftsQuery("fraud risk")).toBe('"fraud"* AND "risk"*');
  });

  it("escapes quotes and ignores punctuation-only input", () => {
    expect(ftsQuery('staff "engineer"')).toBe('"staff"* AND "engineer"*');
    expect(ftsQuery("---")).toBe("");
  });
});
