import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiRepository } from "./api-repository";

describe("API repository", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("serializes job filters and returns live records", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("resource=jobs");
      expect(url).toContain("q=fraud+risk");
      expect(url).toContain("arrangement=remote");
      expect(url).toContain("location=New+York");
      return Response.json([{ id: "job-1", title: "Fraud Analyst" }]);
    });
    vi.stubGlobal("fetch", fetcher);

    const jobs = await createApiRepository().listJobs({
      query: "fraud risk",
      arrangement: "remote",
      location: "New York",
      status: "all",
    });

    expect(jobs).toEqual([{ id: "job-1", title: "Fraud Analyst" }]);
  });

  it("persists keyword rules through the live API", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        action: "createKeyword",
        input: {
          name: "Graph ML",
          includeTerms: ["GNN"],
          excludeTerms: [],
          locations: ["Remote"],
          mode: "six_hour",
        },
      });
      return Response.json({ id: "keyword-1", name: "Graph ML" });
    }));

    const result = await createApiRepository().createKeyword({
      name: "Graph ML",
      includeTerms: ["GNN"],
      excludeTerms: [],
      locations: ["Remote"],
      mode: "six_hour",
    });

    expect(result.id).toBe("keyword-1");
  });

  it("surfaces non-success API responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("No database", { status: 503 })));

    await expect(createApiRepository().listSources()).rejects.toThrow("No database");
  });
});
