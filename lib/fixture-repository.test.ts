import { describe, expect, it } from "vitest";
import { createFixtureRepository } from "./fixture-repository";

describe("fixture repository", () => {
  it("uses the same deterministic AI/data topic classification in demo mode", async () => {
    const repository = createFixtureRepository();
    const result = await repository.searchJobs({ topics: ["ai-data"] });

    expect(result.items.map((job) => job.id)).toContain("job-002");
    expect(result.items.map((job) => job.id)).not.toContain("job-001");
    expect(result.total).toBeLessThan(12);
  });

  it("filters jobs by query and match status", async () => {
    const repository = createFixtureRepository();
    const jobs = await repository.listJobs({ query: "fraud", status: "new" });

    expect(jobs.length).toBeGreaterThan(0);
    expect(
      jobs.every((job) =>
        `${job.title} ${job.summary}`.toLowerCase().includes("fraud"),
      ),
    ).toBe(true);
    expect(jobs.every((job) => job.status === "new")).toBe(true);
  });

  it("returns a deduplicated, paginated search result with bounded filter options", async () => {
    const repository = createFixtureRepository();
    const result = await repository.searchJobs({
      arrangement: "remote",
      page: 2,
      pageSize: 2,
    });

    expect(result.total).toBe(5);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(2);
    expect(result.items.map((job) => job.id)).toEqual(["job-004", "job-011"]);
    expect(result.availableFilters.arrangements).toEqual([
      { value: "hybrid", count: 5 },
      { value: "remote", count: 5 },
      { value: "onsite", count: 2 },
    ]);
    expect(result.availableFilters.companies).toContainEqual({ value: "Stripe", count: 1 });
  });

  it("treats City, ST fixture locations as United States country facets", async () => {
    const repository = createFixtureRepository();
    const result = await repository.searchJobs({ countries: ["US"] });

    expect(result.total).toBe(12);
    expect(result.availableFilters.countries).toEqual([{ value: "US", count: 12 }]);
  });

  it("creates a demo crawl event without a network result", async () => {
    const repository = createFixtureRepository();
    const event = await repository.simulateCrawl();

    expect(event.kind).toBe("crawl.demo");
    expect(event.summary).toContain("Demo data");
  });
});
