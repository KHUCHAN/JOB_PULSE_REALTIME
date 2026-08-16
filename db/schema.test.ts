import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

describe("filterable job schema", () => {
  it("models structured job detail fields used by the crawler", () => {
    expect(Object.keys(getTableColumns(schema.jobs))).toEqual(expect.arrayContaining([
      "description", "responsibilities", "qualifications", "skills", "department", "team",
      "businessUnit", "jobFamily", "jobFunction", "industry", "secondaryLocations",
      "locationCity", "locationState", "locationCountry", "salaryMin", "salaryMax",
      "salaryCurrency", "salaryInterval", "experienceLevel", "requisitionId", "rawPayload",
      "requisitionIdentityKey", "externalIdentityKey", "urlIdentityKey", "alertDiscoveredAfterBaseline",
    ]));
  });

  it("models source-native facet values independently from jobs", () => {
    const sourceFacets = (schema as Record<string, unknown>).sourceFacets;
    expect(sourceFacets).toBeDefined();
    expect(Object.keys(getTableColumns(sourceFacets as Parameters<typeof getTableColumns>[0]))).toEqual(expect.arrayContaining([
      "sourceId", "facetKey", "facetLabel", "valueKey", "valueLabel", "jobCount", "observedAt",
    ]));
  });

  it("models a durable filter-option cache for fast first loads", () => {
    expect(Object.keys(getTableColumns(schema.jobFilterOptionsCache))).toEqual(expect.arrayContaining([
      "filterKey", "normalizedValue", "valueLabel", "jobCount", "refreshedAt",
    ]));
  });

  it("stores a per-source facet generation lease for overlap-safe cleanup", () => {
    expect(Object.keys(getTableColumns(schema.sources))).toContain("facetSyncGeneration");
    expect(Object.keys(getTableColumns(schema.sources))).toContain("alertBaselineAt");
  });

  it("stores durable posting delivery identities independently from notification envelopes", () => {
    expect(Object.keys(getTableColumns(schema.notificationIdentityHistory))).toEqual(expect.arrayContaining([
      "profileId", "recipient", "identityKey", "firstSentAt", "notificationId", "jobMatchId",
    ]));
  });

  it("indexes the structured equality and range predicates used by job search", () => {
    const indexes = getTableConfig(schema.jobs).indexes.map((entry) => [
      entry.config.name,
      entry.config.columns.map((column) => "name" in column ? String(column.name) : String(column)),
    ]);

    expect(indexes).toEqual(expect.arrayContaining([
      ["jobs_status_company_idx", ["status", "company"]],
      ["jobs_status_arrangement_idx", ["status", "arrangement"]],
      ["jobs_status_employment_type_idx", ["status", "employment_type"]],
      ["jobs_status_published_at_idx", ["status", "published_at"]],
      ["jobs_location_country_state_city_idx", ["location_country", "location_state", "location_city"]],
      ["jobs_experience_level_idx", ["experience_level"]],
      ["jobs_salary_currency_min_max_idx", ["salary_currency", "salary_min", "salary_max"]],
      ["jobs_status_url_seen_company_id_idx", ["status", "official_url", "first_seen_at", "company", "id"]],
    ]));
    expect(getTableConfig(schema.jobs).indexes.map((entry) => entry.config.name)).toEqual(expect.arrayContaining([
      "jobs_status_company_nocase_idx",
      "jobs_status_employment_type_nocase_idx",
      "jobs_location_country_state_city_nocase_idx",
      "jobs_experience_level_nocase_idx",
      "jobs_salary_currency_min_max_nocase_idx",
    ]));
  });

  it("keeps immutable, correctly chained snapshots for the search performance migration", () => {
    const before = JSON.parse(readFileSync(join(process.cwd(), "drizzle/meta/0031_snapshot.json"), "utf8"));
    const after = JSON.parse(readFileSync(join(process.cwd(), "drizzle/meta/0032_snapshot.json"), "utf8"));
    const noCase = JSON.parse(readFileSync(join(process.cwd(), "drizzle/meta/0033_snapshot.json"), "utf8"));

    expect(before.tables.jobs.indexes).not.toHaveProperty("jobs_status_url_seen_company_id_idx");
    expect(after.prevId).toBe(before.id);
    expect(after.tables.jobs.indexes).toHaveProperty("jobs_status_url_seen_company_id_idx");
    expect(noCase.prevId).toBe(after.id);
    expect(noCase.tables.jobs.indexes).toHaveProperty("jobs_status_company_nocase_idx");
  });
});
