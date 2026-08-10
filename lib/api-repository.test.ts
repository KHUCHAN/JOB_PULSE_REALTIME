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

  it("serializes repeated filters and maps a paginated result", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return Response.json({
        items: [{ id: "job-1", title: "2027 Internship" }],
        total: 246,
        page: 2,
        pageSize: 50,
      });
    });
    vi.stubGlobal("fetch", fetcher);

    const result = await createApiRepository().searchJobs({
      recruitingYears: [2027],
      programTypes: ["internship", "coop"],
      companies: ["SpaceX"],
      page: 2,
    });

    const requestUrl = String(fetcher.mock.calls[0][0]);
    expect(requestUrl).toContain("resource=jobs");
    expect(requestUrl).toContain("year=2027");
    expect(requestUrl).toContain("program=internship");
    expect(requestUrl).toContain("program=coop");
    expect(requestUrl).toContain("company=SpaceX");
    expect(requestUrl).toContain("page=2");
    expect(result.total).toBe(246);
    expect(result.items).toEqual([{ id: "job-1", title: "2027 Internship" }]);
    expect(result).not.toHaveProperty("availableFilters");
  });

  it("loads global filter options from an independent resource", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/pulse?resource=jobFilterOptions");
      return Response.json({ companies: [{ value: "Acme", count: 10 }] });
    });
    vi.stubGlobal("fetch", fetcher);

    const options = await createApiRepository().getJobFilterOptions();

    expect(options.companies).toEqual([{ value: "Acme", count: 10 }]);
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
