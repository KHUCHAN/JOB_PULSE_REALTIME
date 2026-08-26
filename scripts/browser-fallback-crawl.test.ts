import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { CrawledJob, CrawlSource } from "../lib/crawler";
import { browserChallengeHtml, browserListingSource, browserResultClassification, curlNativeFetch, fedExBrowserApiResult, nativeRunnerRecoveryEligible, persistenceSql, recoverNativeOutsideWorker, type BrowserFallbackResult } from "./browser-fallback-crawl";

describe("browser fallback Workday recovery", () => {
  it("uses the independent runner's official CXS access before browser rendering", async () => {
    const source = {
      id: "workday-source",
      company: "Acme",
      postingUrl: "https://acme.wd5.myworkdayjobs.com/Careers",
      adapter: "workday" as const,
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({
        total: 1,
        jobPostings: [{
          title: "Data Science Intern",
          externalPath: "/job/New-York/Data-Science-Intern_JR-10001",
          locationsText: "New York, NY",
          postedOn: "Posted Today",
          bulletFields: ["Intern", "JR-10001"],
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await recoverNativeOutsideWorker(
      source,
      fetcher as typeof fetch,
      new Date("2026-08-15T12:00:00Z"),
    );

    expect(result).toMatchObject({
      status: 200,
      finalUrl: source.postingUrl,
      completeListing: true,
      error: null,
      jobs: [{
        title: "Data Science Intern",
        externalId: "JR-10001",
        employmentType: "Internship",
        publishedAt: "2026-08-15T12:00:00.000Z",
      }],
    });
    expect(fetcher).toHaveBeenCalled();
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/wday/cxs/acme/Careers/jobs");
  });

  it("leaves non-Workday sources on the normal browser-recovery path", async () => {
    const fetcher = vi.fn();
    await expect(recoverNativeOutsideWorker({
      id: "custom-source",
      company: "Acme",
      postingUrl: "https://acme.example/careers",
      adapter: "custom",
    }, fetcher as typeof fetch)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("promotes a page-one native checkpoint that reaches its verified tail", async () => {
    const block = (id: string) => `<div class="search--item"><p><a href="/posting/data-intern/${id}">Data Intern</a></p><label>Location</label><p>Oak Brook, Illinois</p></div>`;
    const result = await recoverNativeOutsideWorker({
      id: "legacy-row-777",
      company: "Ace Hardware",
      postingUrl: "https://careers.acehardware.com/",
      adapter: "custom",
      attemptNativeRecovery: true,
    }, (async () => Response.json({
      showing: "Showing  of  Results",
      pagination: '<button data-href="2">Next</button>',
      postings: { jobs: block("REQ-123456") },
    })) as typeof fetch);

    expect(result).toMatchObject({
      completeListing: true,
      jobs: [{ externalId: "REQ-123456" }],
    });
  });

  it("does not promote a partial native checkpoint whose adapter reported an error", async () => {
    const job = (index: number) => ({
      reference: `P25-${index}-1`, title: `Handler ${index}`, brandName: "FedEx",
      locations: [{ city: "Memphis", stateAbbr: "TN", country: "United States", countryAbbr: "US", locationParsedText: "Memphis, TN, United States" }],
      isRemote: false, employmentType: ["Part Time"],
      applyURL: `https://fedex.paradox.ai/co/FederalExpressCorporation41/Job?job_id=P25-${index}-1`,
      originalURL: `handler-${index}/job/P25-${index}-1`, customFields: [],
    });
    const fetcher = async (input: RequestInfo | URL) => {
      const page = Number(new URL(String(input)).pathname.match(/\/(\d+)$/)?.[1]);
      const start = page === 2 ? 1 : (page - 1) * 100 + 1;
      const jobs = Array.from({ length: page < 3 ? 100 : 50 }, (_, offset) => job(start + offset));
      return new Response(`<script>window.__PRELOAD_STATE__ = ${JSON.stringify({
        jobSearch: {
          params: { page_number: page, page_size: 100, filter: { country: ["United States"] }, sort_by: "update_date" },
          totalJob: 250, jobs,
        },
      })};</script>`);
    };

    await expect(recoverNativeOutsideWorker({
      id: "audit-row-359", company: "FedEx", postingUrl: "https://careers.fedex.com/", adapter: "custom", attemptNativeRecovery: true,
    }, fetcher as typeof fetch)).resolves.toBeNull();
  });

  it("validates and joins a bounded FedEx browser API window", () => {
    const source = { id: "audit-row-359", company: "FedEx", postingUrl: "https://careers.fedex.com/jobs/page/1", adapter: "custom" as const };
    const job = (index: number) => ({
      reference: `P25-${index}-1`, title: `Handler ${index}`, brandName: "FedEx",
      locations: [{ city: "Memphis", stateAbbr: "TN", country: "United States", countryAbbr: "US", locationParsedText: "Memphis, TN, United States" }],
      isRemote: false, employmentType: ["Part Time"],
      applyURL: `https://fedex.paradox.ai/co/FederalExpressCorporation41/Job?job_id=P25-${index}-1`,
      originalURL: `handler-${index}/job/P25-${index}-1`, customFields: [],
    });
    const pages = [1, 2, 3].map((page) => ({
      page,
      status: 200,
      payload: {
        totalJob: 250,
        jobs: Array.from({ length: page < 3 ? 100 : 50 }, (_, offset) => job((page - 1) * 100 + offset + 1)),
      },
    }));

    expect(fedExBrowserApiResult(source, pages, source.postingUrl)).toEqual(expect.objectContaining({
      status: 200, completeListing: true, error: null,
      jobs: expect.arrayContaining([expect.objectContaining({ externalId: "P25-250-1" })]),
    }));
    const oneBoundaryRepeat = {
      ...pages[1],
      payload: {
        totalJob: 250,
        jobs: [job(100), ...Array.from({ length: 99 }, (_, offset) => job(offset + 102))],
      },
    };
    expect(fedExBrowserApiResult(source, [pages[0], oneBoundaryRepeat, pages[2]], source.postingUrl))
      .toEqual(expect.objectContaining({ jobs: expect.any(Array), error: null }));
    expect(fedExBrowserApiResult(source, [pages[0], { ...pages[1], payload: pages[0].payload }, pages[2]], source.postingUrl))
      .toEqual(expect.objectContaining({ jobs: [], error: "FedEx browser API page 2 repeated too many prior job identities." }));
  });

  it("selects only known Worker-egress failures for the independent native pass", () => {
    expect(nativeRunnerRecoveryEligible({ id: "p5-1077-tesla", adapter: "custom" })).toBe(true);
    expect(nativeRunnerRecoveryEligible({ adapter: "workday" })).toBe(true);
    expect(nativeRunnerRecoveryEligible({ adapter: "custom", health: "blocked", currentJobs: 0 })).toBe(true);
    expect(nativeRunnerRecoveryEligible({
      adapter: "custom",
      health: "failed",
      currentJobs: 24,
      lastError: "iCIMS returned an incomplete or unstable catalog page.",
    })).toBe(true);
    expect(nativeRunnerRecoveryEligible({
      adapter: "custom",
      health: "failed",
      currentJobs: 0,
      lastError: "No supported public job feed or job listings were discovered.",
    })).toBe(false);
    expect(nativeRunnerRecoveryEligible({
      adapter: "custom",
      health: "failed",
      currentJobs: 0,
      lastError: "No supported public job feed or job listings were discovered.",
    }, true)).toBe(true);
    expect(nativeRunnerRecoveryEligible({
      adapter: "custom",
      health: "failed",
      currentJobs: 0,
      lastError: "empty_board",
    })).toBe(true);
  });

  it("records an independently verified authoritative empty Workday board as healthy", async () => {
    const source = {
      id: "empty-workday",
      company: "Acme",
      postingUrl: "https://acme.wd5.myworkdayjobs.com/Careers",
      adapter: "workday" as const,
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ total: 0, jobPostings: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await recoverNativeOutsideWorker(source, fetcher as typeof fetch);
    expect(result).toMatchObject({ authoritativeEmpty: true, jobs: [], status: 200 });
    expect(browserResultClassification(result!)).toEqual({ status: "succeeded", code: "empty_board" });
  });

  it("replays native API requests through the bounded curl HTTP/1.1 transport", async () => {
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          method: request.method,
          token: request.headers["x-test-token"],
          body: Buffer.concat(chunks).toString("utf8"),
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server address was unavailable.");
      const response = await curlNativeFetch(`http://127.0.0.1:${address.port}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-token": "verified" },
        body: JSON.stringify({ page: 2 }),
      });
      await expect(response.json()).resolves.toEqual({
        method: "POST",
        token: "verified",
        body: JSON.stringify({ page: 2 }),
      });
      expect(response.status).toBe(200);
      expect(response.url).toContain("/jobs");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe("browser fallback source normalization", () => {
  it("starts Delta recovery on the official internship search instead of a stale catalog cursor", () => {
    expect(browserListingSource({
      id: "audit-row-342",
      company: "Delta Air Lines",
      postingUrl: "https://delta.avature.net/en_US/careers/SearchJobs/?jobOffset=40",
      adapter: "custom",
    }).postingUrl).toBe("https://delta.avature.net/en_US/careers/SearchJobs/?2884=75201&2884_format=3665&listFilterMode=1&jobOffset=0");
  });

  it("keeps Edwards recovery on the complete official Workday catalog", () => {
    expect(browserListingSource({
      id: "p5-0588-edwards-lifesciences",
      company: "Edwards Lifesciences",
      postingUrl: "https://www.edwards.com/careers/jobsearch",
      adapter: "custom",
    })).toMatchObject({
      postingUrl: "https://edwards.wd5.myworkdayjobs.com/EdwardsCareers",
      adapter: "workday",
    });
  });

  it("keeps Core & Main recovery on the complete official Workday catalog", () => {
    expect(browserListingSource({
      id: "legacy-row-87",
      company: "Core & Main",
      postingUrl: "https://jobs.coreandmain.com/p/coreandmain/jobs",
      adapter: "custom",
    })).toMatchObject({
      postingUrl: "https://coreandmain.wd1.myworkdayjobs.com/coreandmain",
      adapter: "workday",
    });
  });

  it("leaves unrelated sources unchanged", () => {
    const source: CrawlSource = {
      id: "source-1",
      company: "Acme",
      postingUrl: "https://jobs.example.com/?page=4",
      adapter: "custom",
    };
    expect(browserListingSource(source)).toBe(source);
  });
});

describe("browser fallback persistenceSql", () => {
  it("persists location region and replaces direct managed job areas", () => {
    const source: CrawlSource = {
      id: "source-1",
      company: "Acme",
      postingUrl: "https://jobs.example.com",
      adapter: "custom",
    };
    const job = {
      externalId: "swe-1",
      title: "Summer 2027 Software Engineering Internship",
      company: "Acme",
      location: "Austin, TX",
      locationCountry: "United States",
      arrangement: "onsite",
      employmentType: "Internship",
      summary: "Build software.",
      officialUrl: "https://jobs.example.com/swe-1",
      publishedAt: "2026-08-10T00:00:00.000Z",
    } satisfies CrawledJob;
    const result: BrowserFallbackResult = {
      source,
      status: 200,
      finalUrl: source.postingUrl,
      jobs: [job],
      error: null,
    };

    const sql = persistenceSql([result]);

    expect(sql).toContain("location_region");
    expect(sql).toContain("area_classified_at");
    expect(sql).toMatch(/v3:\d{4}-\d{2}-\d{2}T/);
    expect(sql).toContain("location_region=CASE WHEN excluded.location_region='unknown'");
    expect(sql).toContain("requisition_identity_key");
    expect(sql).toContain("url:https://jobs.example.com/swe-1");
    expect(sql).toContain("alert_discovered_after_baseline) VALUES");
    expect(sql).toContain("alert_baseline_at=COALESCE(alert_baseline_at");
    expect(sql).toContain("DELETE FROM job_topics WHERE topic_key LIKE 'area:%'");
    expect(sql).toContain("area:software-engineering");
  });
});

describe("browser fallback result classification", () => {
  it("recognizes access-verification HTML and HTTP errors hidden inside browser exceptions", () => {
    expect(browserChallengeHtml('<html><title>Quick Check Needed</title><script src="/vx/oleeoProtect/main.js"></script></html>')).toBe(true);
    expect(browserChallengeHtml("<html><title>Careers</title></html>")).toBe(false);
    expect(browserResultClassification({
      source: { id: "tesla", company: "Tesla", postingUrl: "https://tesla.com/careers", adapter: "custom" },
      status: null,
      finalUrl: null,
      jobs: [],
      error: "Tesla browser state returned HTTP 403.",
    })).toEqual({ status: "blocked", code: "blocked_challenge" });
    expect(browserResultClassification({
      source: { id: "p5-1077-tesla", company: "Tesla", postingUrl: "https://www.tesla.com/careers/search", adapter: "custom" },
      status: null,
      finalUrl: null,
      jobs: [],
      error: "Browser fallback exceeded 60 seconds.",
    })).toEqual({ status: "blocked", code: "blocked_challenge" });
  });

  it("keeps a 2xx page with no verified jobs retryable instead of healthy", () => {
    expect(browserResultClassification({
      source: {
        id: "source-empty",
        company: "Acme",
        postingUrl: "https://jobs.example.com",
        adapter: "custom",
      },
      status: 200,
      finalUrl: "https://jobs.example.com",
      jobs: [],
      error: null,
    })).toEqual({ status: "failed", code: "empty_board" });
  });
});
