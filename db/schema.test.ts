import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

describe("filterable job schema", () => {
  it("models structured job detail fields used by the crawler", () => {
    expect(Object.keys(getTableColumns(schema.jobs))).toEqual(expect.arrayContaining([
      "description", "responsibilities", "qualifications", "skills", "department", "team",
      "businessUnit", "jobFamily", "jobFunction", "industry", "secondaryLocations",
      "locationCity", "locationState", "locationCountry", "salaryMin", "salaryMax",
      "salaryCurrency", "salaryInterval", "experienceLevel", "requisitionId", "rawPayload",
    ]));
  });

  it("models source-native facet values independently from jobs", () => {
    const sourceFacets = (schema as Record<string, unknown>).sourceFacets;
    expect(sourceFacets).toBeDefined();
    expect(Object.keys(getTableColumns(sourceFacets as Parameters<typeof getTableColumns>[0]))).toEqual(expect.arrayContaining([
      "sourceId", "facetKey", "facetLabel", "valueKey", "valueLabel", "jobCount", "observedAt",
    ]));
  });

  it("stores a per-source facet generation lease for overlap-safe cleanup", () => {
    expect(Object.keys(getTableColumns(schema.sources))).toContain("facetSyncGeneration");
  });
});
