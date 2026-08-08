import { describe, expect, it } from "vitest";
import { createFixtureRepository } from "./fixture-repository";

describe("fixture repository", () => {
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

  it("creates a demo crawl event without a network result", async () => {
    const repository = createFixtureRepository();
    const event = await repository.simulateCrawl();

    expect(event.kind).toBe("crawl.demo");
    expect(event.summary).toContain("Demo data");
  });
});
